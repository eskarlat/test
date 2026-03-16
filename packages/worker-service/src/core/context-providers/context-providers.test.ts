import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
  listProviders: vi.fn(),
  getServerPort: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("../../core/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let db: InstanceType<typeof Database>;

vi.mock("../../core/db-manager.js", () => ({
  dbManager: {
    getConnection: () => db,
  },
}));

vi.mock("node:child_process", () => ({
  execFileSync: mocks.execFileSync,
  spawnSync: mocks.spawnSync,
}));

vi.mock("../../core/context-provider-manager.js", () => ({
  listProviders: mocks.listProviders,
}));

vi.mock("../../core/server-port.js", () => ({
  getServerPort: mocks.getServerPort,
}));

import { buildResult } from "./build-result.js";
import { errorPatternsProvider } from "./error-patterns-provider.js";
import { sessionHistoryProvider } from "./session-history-provider.js";
import { observationsProvider } from "./observations-provider.js";
import { toolRulesProvider } from "./tool-rules-provider.js";
import { extensionContextProvider } from "./extension-provider.js";

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      agent TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      ended_at TEXT,
      summary TEXT,
      prompt_count INTEGER DEFAULT 0,
      tool_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      files_modified TEXT DEFAULT '[]',
      decisions TEXT DEFAULT '[]',
      context_injected INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0,
      source TEXT
    );

    CREATE TABLE IF NOT EXISTS _error_patterns (
      fingerprint TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      message_template TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      session_count INTEGER NOT NULL DEFAULT 1,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      resolve_note TEXT
    );

    CREATE TABLE IF NOT EXISTS _observations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user',
      category TEXT NOT NULL DEFAULT 'general',
      confidence REAL NOT NULL DEFAULT 1.0,
      active INTEGER NOT NULL DEFAULT 1,
      last_injected_at TEXT,
      injection_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS _tool_rules (
      id TEXT PRIMARY KEY,
      pattern TEXT NOT NULL,
      decision TEXT NOT NULL,
      tool_type TEXT,
      reason TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
}

describe("context-providers", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    createTables();
    vi.clearAllMocks();
  });

  describe("buildResult", () => {
    it("returns content within maxChars without truncation", () => {
      const result = buildResult("Hello world", 100, 1);
      expect(result.content).toBe("Hello world");
      expect(result.truncated).toBe(false);
      expect(result.itemCount).toBe(1);
      expect(result.estimatedTokens).toBe(Math.ceil(11 / 4));
    });

    it("truncates content exceeding maxChars", () => {
      const longContent = "a".repeat(200);
      const result = buildResult(longContent, 50, 1);
      expect(result.content).toHaveLength(50);
      expect(result.truncated).toBe(true);
      expect(result.estimatedTokens).toBe(Math.ceil(50 / 4));
    });

    it("handles empty content", () => {
      const result = buildResult("", 100, 0);
      expect(result.content).toBe("");
      expect(result.truncated).toBe(false);
      expect(result.estimatedTokens).toBe(0);
      expect(result.itemCount).toBe(0);
    });
  });

  describe("errorPatternsProvider", () => {
    it("has correct id and metadata", () => {
      expect(errorPatternsProvider.id).toBe("error-patterns");
      expect(errorPatternsProvider.name).toBe("Error Patterns");
    });

    it("returns empty content when no error patterns exist", async () => {
      const result = await errorPatternsProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");
      expect(result.itemCount).toBe(0);
    });

    it("returns error patterns with 3+ occurrences", async () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO _error_patterns (fingerprint, project_id, message_template, occurrence_count, session_count, first_seen, last_seen, status)
         VALUES (?, ?, ?, ?, 1, ?, ?, 'active')`,
      ).run("fp-1", "proj-1", "TypeError: undefined is not a function", 5, now, now);
      db.prepare(
        `INSERT INTO _error_patterns (fingerprint, project_id, message_template, occurrence_count, session_count, first_seen, last_seen, status)
         VALUES (?, ?, ?, ?, 1, ?, ?, 'active')`,
      ).run("fp-2", "proj-1", "RangeError: stack overflow", 2, now, now); // below threshold

      const result = await errorPatternsProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toContain("Known Error Patterns");
      expect(result.content).toContain("TypeError: undefined is not a function");
      expect(result.content).not.toContain("RangeError");
      expect(result.itemCount).toBe(1);
    });

    it("filters by project_id", async () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO _error_patterns (fingerprint, project_id, message_template, occurrence_count, session_count, first_seen, last_seen, status)
         VALUES (?, ?, ?, ?, 1, ?, ?, 'active')`,
      ).run("fp-1", "proj-2", "Some error", 5, now, now);

      const result = await errorPatternsProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");
    });

    it("excludes resolved patterns", async () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO _error_patterns (fingerprint, project_id, message_template, occurrence_count, session_count, first_seen, last_seen, status)
         VALUES (?, ?, ?, ?, 1, ?, ?, 'resolved')`,
      ).run("fp-1", "proj-1", "Resolved error", 5, now, now);

      const result = await errorPatternsProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");
    });
  });

  describe("sessionHistoryProvider", () => {
    it("has correct id and metadata", () => {
      expect(sessionHistoryProvider.id).toBe("session-history");
      expect(sessionHistoryProvider.name).toBe("Session History");
    });

    it("returns empty content when no ended sessions exist", async () => {
      const result = await sessionHistoryProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");
      expect(result.itemCount).toBe(0);
    });

    it("returns recent ended sessions with summaries", async () => {
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, ended_at, agent, status, summary, prompt_count, tool_count, archived)
         VALUES (?, ?, ?, ?, ?, 'ended', ?, 5, 10, 0)`,
      ).run("s-1", "proj-1", "2025-06-01T00:00:00Z", "2025-06-01T01:00:00Z", "claude", "Refactored auth module");

      const result = await sessionHistoryProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toContain("Recent Sessions");
      expect(result.content).toContain("2025-06-01");
      expect(result.content).toContain("claude");
      expect(result.content).toContain("Refactored auth module");
      expect(result.content).toContain("5 prompts");
      expect(result.content).toContain("10 tools");
      expect(result.itemCount).toBe(1);
    });

    it("excludes sessions without summary", async () => {
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, agent, status, archived)
         VALUES (?, ?, ?, ?, 'ended', 0)`,
      ).run("s-1", "proj-1", "2025-06-01T00:00:00Z", "claude");

      const result = await sessionHistoryProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");
    });

    it("excludes archived sessions", async () => {
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, agent, status, summary, prompt_count, tool_count, archived)
         VALUES (?, ?, ?, ?, 'ended', ?, 5, 10, 1)`,
      ).run("s-1", "proj-1", "2025-06-01T00:00:00Z", "claude", "Archived session");

      const result = await sessionHistoryProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");
    });
  });

  describe("observationsProvider", () => {
    it("has correct id and metadata", () => {
      expect(observationsProvider.id).toBe("observations");
      expect(observationsProvider.name).toBe("Observations");
    });

    it("returns empty content when no observations exist", async () => {
      const result = await observationsProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");
      expect(result.itemCount).toBe(0);
    });

    it("returns active observations", async () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO _observations (id, project_id, content, source, category, confidence, active, injection_count, created_at, updated_at)
         VALUES (?, ?, ?, 'user', 'coding', 1.0, 1, 0, ?, ?)`,
      ).run("o-1", "proj-1", "Always use strict mode", now, now);

      const result = await observationsProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toContain("Observations");
      expect(result.content).toContain("[coding] Always use strict mode");
      expect(result.itemCount).toBe(1);
    });

    it("excludes inactive observations", async () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO _observations (id, project_id, content, source, category, confidence, active, injection_count, created_at, updated_at)
         VALUES (?, ?, ?, 'user', 'general', 1.0, 0, 0, ?, ?)`,
      ).run("o-1", "proj-1", "Inactive observation", now, now);

      const result = await observationsProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");
    });
  });

  describe("toolRulesProvider", () => {
    it("has correct id and metadata", () => {
      expect(toolRulesProvider.id).toBe("tool-rules");
      expect(toolRulesProvider.name).toBe("Tool Governance Rules");
    });

    it("returns empty content when no deny rules exist", async () => {
      const result = await toolRulesProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");
    });

    it("returns global deny rules", async () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO _tool_rules (id, pattern, decision, reason, priority, scope, enabled, hit_count, created_at)
         VALUES (?, ?, 'deny', ?, 10, 'global', 1, 0, ?)`,
      ).run("r-1", "rm -rf *", "Dangerous command", now);

      const result = await toolRulesProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toContain("Tool Governance Rules");
      expect(result.content).toContain("DENY: rm -rf *");
      expect(result.content).toContain("Dangerous command");
    });

    it("returns project-specific deny rules", async () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO _tool_rules (id, pattern, decision, reason, priority, scope, project_id, enabled, hit_count, created_at)
         VALUES (?, ?, 'deny', ?, 10, 'project', ?, 1, 0, ?)`,
      ).run("r-1", "git push --force", "Never force push", "proj-1", now);

      const result = await toolRulesProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toContain("DENY: git push --force");
    });

    it("excludes allow rules", async () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO _tool_rules (id, pattern, decision, reason, priority, scope, enabled, hit_count, created_at)
         VALUES (?, ?, 'allow', ?, 10, 'global', 1, 0, ?)`,
      ).run("r-1", "git status", "Always allowed", now);

      const result = await toolRulesProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");
    });

    it("excludes disabled rules", async () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO _tool_rules (id, pattern, decision, reason, priority, scope, enabled, hit_count, created_at)
         VALUES (?, ?, 'deny', ?, 10, 'global', 0, 0, ?)`,
      ).run("r-1", "rm -rf", "Disabled rule", now);

      const result = await toolRulesProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");
    });

    it("formats rules without reason correctly", async () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO _tool_rules (id, pattern, decision, priority, scope, enabled, hit_count, created_at)
         VALUES (?, ?, 'deny', 10, 'global', 1, 0, ?)`,
      ).run("r-1", "drop table", now);

      const result = await toolRulesProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toContain("DENY: drop table");
      expect(result.content).not.toContain(" -- ");
    });
  });

  describe("extensionContextProvider", () => {
    it("has correct id and metadata", () => {
      expect(extensionContextProvider.id).toBe("extension-providers");
      expect(extensionContextProvider.name).toBe("Extension Context");
    });

    it("returns empty when no extension providers registered", async () => {
      mocks.listProviders.mockReturnValue([]);
      const result = await extensionContextProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");
      expect(result.itemCount).toBe(0);
    });

    it("returns empty when no providers have type extension", async () => {
      mocks.listProviders.mockReturnValue([
        { id: "core-1", type: "core", name: "Core Provider", description: "", defaultEnabled: true },
      ]);
      const result = await extensionContextProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");
    });

    it("fetches context from extension providers", async () => {
      mocks.listProviders.mockReturnValue([
        { id: "ext-1", type: "extension", extensionName: "my-ext", name: "My Extension", description: "", defaultEnabled: true },
      ]);
      mocks.getServerPort.mockReturnValue(42888);

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ content: "Extension context data" }),
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      const result = await extensionContextProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("Extension context data");
      expect(result.itemCount).toBe(1);

      vi.unstubAllGlobals();
    });

    it("handles failed fetch gracefully", async () => {
      mocks.listProviders.mockReturnValue([
        { id: "ext-1", type: "extension", extensionName: "my-ext", name: "My Extension", description: "", defaultEnabled: true },
      ]);
      mocks.getServerPort.mockReturnValue(42888);

      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

      const result = await extensionContextProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");
      expect(result.itemCount).toBe(0);

      vi.unstubAllGlobals();
    });

    it("handles non-ok response gracefully", async () => {
      mocks.listProviders.mockReturnValue([
        { id: "ext-1", type: "extension", extensionName: "my-ext", name: "My Extension", description: "", defaultEnabled: true },
      ]);
      mocks.getServerPort.mockReturnValue(42888);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

      const result = await extensionContextProvider.getContext("proj-1", {}, 1000);
      expect(result.content).toBe("");

      vi.unstubAllGlobals();
    });

    it("truncates extension content that exceeds sub-budget", async () => {
      mocks.listProviders.mockReturnValue([
        { id: "ext-1", type: "extension", extensionName: "my-ext", name: "My Extension", description: "", defaultEnabled: true },
      ]);
      mocks.getServerPort.mockReturnValue(42888);

      const longContent = "x".repeat(5000);
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ content: longContent }),
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

      // tokenBudget=100 => subBudget=100 => maxChars=400
      const result = await extensionContextProvider.getContext("proj-1", {}, 100);
      expect(result.content.length).toBeLessThanOrEqual(400);

      vi.unstubAllGlobals();
    });
  });
});
