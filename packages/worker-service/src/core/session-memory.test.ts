import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

vi.mock("../core/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../core/event-bus.js", () => ({
  eventBus: { publish: vi.fn(), subscribe: vi.fn() },
}));

let db: InstanceType<typeof Database>;

vi.mock("../core/db-manager.js", () => ({
  dbManager: {
    getConnection: () => db,
  },
}));

import {
  buildPromptSummary,
  startSession,
  checkpoint,
  archiveOldSessions,
  buildSessionContext,
  recordHookActivity,
  getSessionCheckpoints,
} from "./session-memory.js";
import { eventBus } from "./event-bus.js";

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
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON _sessions (project_id, status);

    CREATE TABLE IF NOT EXISTS _session_checkpoints (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      summary TEXT,
      prompt_count INTEGER DEFAULT 0,
      tool_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      files_modified TEXT DEFAULT '[]',
      custom_instructions TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON _session_checkpoints (session_id);

    CREATE TABLE IF NOT EXISTS _prompts (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      project_id TEXT NOT NULL,
      prompt_preview TEXT NOT NULL,
      intent_category TEXT NOT NULL DEFAULT 'general',
      context_injected INTEGER NOT NULL DEFAULT 0,
      agent TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prompts_project ON _prompts (project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_prompts_session ON _prompts (session_id);

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
    CREATE INDEX IF NOT EXISTS idx_observations_project ON _observations (project_id, active);

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
    CREATE INDEX IF NOT EXISTS idx_error_patterns_project ON _error_patterns (project_id, status);

    CREATE TABLE IF NOT EXISTS _hook_activity (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      project_id TEXT NOT NULL,
      event TEXT NOT NULL,
      feature TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      output_snapshot TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hook_activity_project ON _hook_activity (project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_hook_activity_session ON _hook_activity (session_id);
  `);
}

describe("session-memory", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    createTables();
    vi.clearAllMocks();
  });

  describe("buildPromptSummary", () => {
    it("returns null when no prompts exist for the session", () => {
      const result = buildPromptSummary("non-existent");
      expect(result).toBeNull();
    });

    it("builds summary from first prompt with general intent", () => {
      const sessionId = "sess-1";
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, agent, status, error_count, files_modified)
         VALUES (?, ?, ?, ?, 'active', 0, '[]')`,
      ).run(sessionId, "proj-1", new Date().toISOString(), "claude");
      db.prepare(
        `INSERT INTO _prompts (id, session_id, project_id, prompt_preview, intent_category, created_at)
         VALUES (?, ?, ?, ?, 'general', ?)`,
      ).run("p-1", sessionId, "proj-1", "Hello world", new Date().toISOString());

      const result = buildPromptSummary(sessionId);
      expect(result).toBe("Hello world");
    });

    it("includes intent category prefix for non-general intents", () => {
      const sessionId = "sess-1";
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, agent, status, error_count, files_modified)
         VALUES (?, ?, ?, ?, 'active', 0, '[]')`,
      ).run(sessionId, "proj-1", new Date().toISOString(), "claude");
      db.prepare(
        `INSERT INTO _prompts (id, session_id, project_id, prompt_preview, intent_category, created_at)
         VALUES (?, ?, ?, ?, 'bug-fix', ?)`,
      ).run("p-1", sessionId, "proj-1", "Fix the auth bug", new Date().toISOString());

      const result = buildPromptSummary(sessionId);
      expect(result).toContain("[bug-fix]");
      expect(result).toContain("Fix the auth bug");
    });

    it("includes file modification info", () => {
      const sessionId = "sess-1";
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, agent, status, error_count, files_modified)
         VALUES (?, ?, ?, ?, 'active', 0, ?)`,
      ).run(sessionId, "proj-1", new Date().toISOString(), "claude", JSON.stringify(["src/foo.ts", "src/bar.ts"]));
      db.prepare(
        `INSERT INTO _prompts (id, session_id, project_id, prompt_preview, intent_category, created_at)
         VALUES (?, ?, ?, ?, 'general', ?)`,
      ).run("p-1", sessionId, "proj-1", "Do something", new Date().toISOString());

      const result = buildPromptSummary(sessionId);
      expect(result).toContain("edited foo.ts, bar.ts");
    });

    it("truncates file list when more than 3 files", () => {
      const sessionId = "sess-1";
      const files = ["a/one.ts", "b/two.ts", "c/three.ts", "d/four.ts", "e/five.ts"];
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, agent, status, error_count, files_modified)
         VALUES (?, ?, ?, ?, 'active', 0, ?)`,
      ).run(sessionId, "proj-1", new Date().toISOString(), "claude", JSON.stringify(files));
      db.prepare(
        `INSERT INTO _prompts (id, session_id, project_id, prompt_preview, intent_category, created_at)
         VALUES (?, ?, ?, ?, 'general', ?)`,
      ).run("p-1", sessionId, "proj-1", "Do something", new Date().toISOString());

      const result = buildPromptSummary(sessionId);
      expect(result).toContain("+2 more");
    });

    it("includes error count when > 0", () => {
      const sessionId = "sess-1";
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, agent, status, error_count, files_modified)
         VALUES (?, ?, ?, ?, 'active', 3, '[]')`,
      ).run(sessionId, "proj-1", new Date().toISOString(), "claude");
      db.prepare(
        `INSERT INTO _prompts (id, session_id, project_id, prompt_preview, intent_category, created_at)
         VALUES (?, ?, ?, ?, 'general', ?)`,
      ).run("p-1", sessionId, "proj-1", "Fix bugs", new Date().toISOString());

      const result = buildPromptSummary(sessionId);
      expect(result).toContain("3 errors");
    });

    it("uses singular error for count of 1", () => {
      const sessionId = "sess-1";
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, agent, status, error_count, files_modified)
         VALUES (?, ?, ?, ?, 'active', 1, '[]')`,
      ).run(sessionId, "proj-1", new Date().toISOString(), "claude");
      db.prepare(
        `INSERT INTO _prompts (id, session_id, project_id, prompt_preview, intent_category, created_at)
         VALUES (?, ?, ?, ?, 'general', ?)`,
      ).run("p-1", sessionId, "proj-1", "Fix bugs", new Date().toISOString());

      const result = buildPromptSummary(sessionId);
      expect(result).toContain("1 error");
      expect(result).not.toContain("1 errors");
    });
  });

  describe("startSession", () => {
    it("creates a new session and returns sessionId and additionalContext", () => {
      const result = startSession("proj-1", "claude");
      expect(result.sessionId).toBeTruthy();
      expect(typeof result.additionalContext).toBe("string");

      const row = db.prepare("SELECT * FROM _sessions WHERE id = ?").get(result.sessionId) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.project_id).toBe("proj-1");
      expect(row.agent).toBe("claude");
      expect(row.status).toBe("active");
    });

    it("publishes session:started event", () => {
      const result = startSession("proj-1", "claude");
      expect(eventBus.publish).toHaveBeenCalledWith("session:started", {
        projectId: "proj-1",
        sessionId: result.sessionId,
        agent: "claude",
      });
    });

    it("ends previous active sessions for the same project+agent", () => {
      const first = startSession("proj-1", "claude");
      const second = startSession("proj-1", "claude");

      const firstRow = db.prepare("SELECT status FROM _sessions WHERE id = ?").get(first.sessionId) as { status: string };
      expect(firstRow.status).toBe("ended");

      const secondRow = db.prepare("SELECT status FROM _sessions WHERE id = ?").get(second.sessionId) as { status: string };
      expect(secondRow.status).toBe("active");
    });

    it("does not end sessions for different agents", () => {
      const first = startSession("proj-1", "claude");
      startSession("proj-1", "copilot");

      const firstRow = db.prepare("SELECT status FROM _sessions WHERE id = ?").get(first.sessionId) as { status: string };
      expect(firstRow.status).toBe("active");
    });

    it("includes recent sessions in additionalContext when they exist", () => {
      // Create an ended session
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, ended_at, agent, status, summary, prompt_count, tool_count, error_count, archived)
         VALUES (?, ?, ?, ?, ?, 'ended', ?, 5, 10, 0, 0)`,
      ).run("old-sess", "proj-1", "2025-01-01T00:00:00Z", "2025-01-01T01:00:00Z", "claude", "Did some work");

      const result = startSession("proj-1", "claude");
      expect(result.additionalContext).toContain("Recent Sessions");
      expect(result.additionalContext).toContain("Did some work");
    });

    it("includes error patterns in additionalContext", () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO _error_patterns (fingerprint, project_id, message_template, occurrence_count, session_count, first_seen, last_seen, status)
         VALUES (?, ?, ?, ?, 1, ?, ?, 'active')`,
      ).run("fp-1", "proj-1", "TypeError: undefined is not a function", 5, now, now);

      const result = startSession("proj-1", "claude");
      expect(result.additionalContext).toContain("Known Error Patterns");
      expect(result.additionalContext).toContain("TypeError: undefined is not a function");
    });

    it("includes observations in additionalContext", () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO _observations (id, project_id, content, source, category, confidence, active, injection_count, created_at, updated_at)
         VALUES (?, ?, ?, 'user', 'general', 1.0, 1, 0, ?, ?)`,
      ).run("obs-1", "proj-1", "Always use path.join for paths", now, now);

      const result = startSession("proj-1", "claude");
      expect(result.additionalContext).toContain("Observations");
      expect(result.additionalContext).toContain("Always use path.join for paths");
    });

    it("stores source when provided", () => {
      const result = startSession("proj-1", "claude", "hook");
      const row = db.prepare("SELECT source FROM _sessions WHERE id = ?").get(result.sessionId) as { source: string };
      expect(row.source).toBe("hook");
    });
  });

  describe("checkpoint", () => {
    it("creates a checkpoint and returns compaction summary", () => {
      const sessionId = "sess-1";
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, agent, status, prompt_count, tool_count, error_count, files_modified, decisions)
         VALUES (?, ?, ?, ?, 'active', 10, 25, 2, ?, '[]')`,
      ).run(sessionId, "proj-1", new Date().toISOString(), "claude", JSON.stringify(["src/index.ts"]));

      const summary = checkpoint(sessionId, "proj-1");
      expect(summary).toContain("Session Compaction Summary");
      expect(summary).toContain("10 prompts processed");
      expect(summary).toContain("25 tool uses recorded");
      expect(summary).toContain("2 errors encountered");
      expect(summary).toContain("src/index.ts");

      // Verify checkpoint was saved
      const rows = db.prepare("SELECT * FROM _session_checkpoints WHERE session_id = ?").all(sessionId);
      expect(rows).toHaveLength(1);
    });

    it("includes custom instructions when provided", () => {
      const sessionId = "sess-1";
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, agent, status, prompt_count, tool_count, error_count, files_modified, decisions)
         VALUES (?, ?, ?, ?, 'active', 0, 0, 0, '[]', '[]')`,
      ).run(sessionId, "proj-1", new Date().toISOString(), "claude");

      const summary = checkpoint(sessionId, "proj-1", "Focus on performance");
      expect(summary).toContain("Custom Instructions");
      expect(summary).toContain("Focus on performance");
    });

    it("handles non-existent session gracefully", () => {
      const summary = checkpoint("non-existent", "proj-1");
      expect(summary).toContain("0 prompts processed");
    });
  });

  describe("archiveOldSessions", () => {
    it("archives sessions older than 7 days", () => {
      const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, ended_at, agent, status, archived)
         VALUES (?, ?, ?, ?, ?, 'ended', 0)`,
      ).run("old-sess", "proj-1", old, old, "claude");

      const recent = new Date().toISOString();
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, ended_at, agent, status, archived)
         VALUES (?, ?, ?, ?, ?, 'ended', 0)`,
      ).run("new-sess", "proj-1", recent, recent, "claude");

      const count = archiveOldSessions();
      expect(count).toBe(1);

      const oldRow = db.prepare("SELECT archived FROM _sessions WHERE id = ?").get("old-sess") as { archived: number };
      expect(oldRow.archived).toBe(1);

      const newRow = db.prepare("SELECT archived FROM _sessions WHERE id = ?").get("new-sess") as { archived: number };
      expect(newRow.archived).toBe(0);
    });

    it("returns 0 when no sessions to archive", () => {
      expect(archiveOldSessions()).toBe(0);
    });
  });

  describe("buildSessionContext", () => {
    it("returns recent sessions summary for a project", () => {
      db.prepare(
        `INSERT INTO _sessions (id, project_id, started_at, ended_at, agent, status, summary, prompt_count, tool_count, error_count, archived)
         VALUES (?, ?, ?, ?, ?, 'ended', ?, 5, 10, 0, 0)`,
      ).run("sess-1", "proj-1", "2025-06-01T00:00:00Z", "2025-06-01T01:00:00Z", "claude", "Refactored auth");

      const ctx = buildSessionContext("proj-1");
      expect(ctx).toContain("Recent Sessions");
      expect(ctx).toContain("Refactored auth");
    });

    it("returns empty string when no sessions", () => {
      expect(buildSessionContext("proj-1")).toBe("");
    });
  });

  describe("recordHookActivity", () => {
    it("records hook activity to the database", () => {
      recordHookActivity("sess-1", "proj-1", "preToolUse", "session-memory", 50, true);

      const row = db.prepare("SELECT * FROM _hook_activity WHERE session_id = ?").get("sess-1") as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.event).toBe("preToolUse");
      expect(row.feature).toBe("session-memory");
      expect(row.duration_ms).toBe(50);
      expect(row.success).toBe(1);
    });

    it("records error when provided", () => {
      recordHookActivity("sess-1", "proj-1", "errorOccurred", "error-tracker", 10, false, "Something broke");

      const row = db.prepare("SELECT * FROM _hook_activity WHERE session_id = ?").get("sess-1") as Record<string, unknown>;
      expect(row.success).toBe(0);
      expect(row.error).toBe("Something broke");
    });

    it("records output snapshot for non-empty objects", () => {
      recordHookActivity("sess-1", "proj-1", "postToolUse", "analytics", 20, true, undefined, { key: "value" });

      const row = db.prepare("SELECT * FROM _hook_activity WHERE session_id = ?").get("sess-1") as Record<string, unknown>;
      expect(row.output_snapshot).toBe('{"key":"value"}');
    });

    it("truncates long output snapshots", () => {
      const largeOutput = { data: "x".repeat(600) };
      recordHookActivity("sess-1", "proj-1", "postToolUse", "analytics", 20, true, undefined, largeOutput);

      const row = db.prepare("SELECT * FROM _hook_activity WHERE session_id = ?").get("sess-1") as Record<string, unknown>;
      expect((row.output_snapshot as string).length).toBeLessThanOrEqual(501); // 500 + ellipsis char
    });

    it("does not store output_snapshot for null/undefined/empty output", () => {
      recordHookActivity("sess-1", "proj-1", "preToolUse", "mem", 5, true, undefined, null);

      const row = db.prepare("SELECT * FROM _hook_activity WHERE session_id = ?").get("sess-1") as Record<string, unknown>;
      expect(row.output_snapshot).toBeNull();
    });

    it("does not store output_snapshot for empty object", () => {
      recordHookActivity("sess-2", "proj-1", "preToolUse", "mem", 5, true, undefined, {});

      const row = db.prepare("SELECT * FROM _hook_activity WHERE session_id = ?").get("sess-2") as Record<string, unknown>;
      expect(row.output_snapshot).toBeNull();
    });

    it("handles null sessionId", () => {
      recordHookActivity(null, "proj-1", "sessionStart", "mem", 5, true);

      const row = db.prepare("SELECT * FROM _hook_activity WHERE project_id = ?").get("proj-1") as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.session_id).toBeNull();
    });
  });

  describe("getSessionCheckpoints", () => {
    it("returns checkpoints for a session ordered by created_at", () => {
      db.prepare(
        `INSERT INTO _session_checkpoints (id, session_id, project_id, trigger, prompt_count, tool_count, error_count, files_modified, created_at)
         VALUES (?, ?, ?, 'preCompact', 5, 10, 0, '[]', ?)`,
      ).run("cp-1", "sess-1", "proj-1", "2025-01-01T00:00:00Z");
      db.prepare(
        `INSERT INTO _session_checkpoints (id, session_id, project_id, trigger, prompt_count, tool_count, error_count, files_modified, created_at)
         VALUES (?, ?, ?, 'preCompact', 15, 30, 1, '[]', ?)`,
      ).run("cp-2", "sess-1", "proj-1", "2025-01-02T00:00:00Z");

      const checkpoints = getSessionCheckpoints("sess-1");
      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0].id).toBe("cp-1");
      expect(checkpoints[1].id).toBe("cp-2");
    });

    it("returns empty array for unknown session", () => {
      expect(getSessionCheckpoints("non-existent")).toEqual([]);
    });
  });
});
