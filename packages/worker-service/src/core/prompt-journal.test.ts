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

import { record, list, analytics, search, purgeOld, getStats } from "./prompt-journal.js";

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
  `);
}

describe("prompt-journal", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    createTables();
  });

  describe("record", () => {
    it("inserts a prompt record and returns it", () => {
      const result = record("proj-1", null, "Fix the login bug");
      expect(result).not.toBeNull();
      expect(result!.projectId).toBe("proj-1");
      expect(result!.promptPreview).toBe("Fix the login bug");
      expect(result!.intentCategory).toBe("bug-fix");
      expect(result!.contextInjected).toBe(false);
    });

    it("truncates prompt preview to 200 characters", () => {
      const longPrompt = "a".repeat(300);
      const result = record("proj-1", null, longPrompt);
      expect(result).not.toBeNull();
      expect(result!.promptPreview).toHaveLength(200);
    });

    it("detects bug-fix intent", () => {
      const result = record("proj-1", null, "Fix this broken test");
      expect(result!.intentCategory).toBe("bug-fix");
    });

    it("detects feature intent", () => {
      const result = record("proj-1", null, "Add a new dark mode toggle");
      expect(result!.intentCategory).toBe("feature");
    });

    it("detects refactor intent", () => {
      const result = record("proj-1", null, "Refactor the auth module");
      expect(result!.intentCategory).toBe("refactor");
    });

    it("detects question intent", () => {
      const result = record("proj-1", null, "What does this function do?");
      expect(result!.intentCategory).toBe("question");
    });

    it("detects test intent", () => {
      const result = record("proj-1", null, "Write unit test for parser");
      expect(result!.intentCategory).toBe("test");
    });

    it("falls back to general intent", () => {
      const result = record("proj-1", null, "hello world");
      expect(result!.intentCategory).toBe("general");
    });

    it("increments session prompt_count when sessionId is provided", () => {
      // Create a session first
      db.prepare(
        "INSERT INTO _sessions (id, project_id, started_at, agent, status) VALUES (?, ?, ?, ?, 'active')",
      ).run("sess-1", "proj-1", new Date().toISOString(), "claude");

      record("proj-1", "sess-1", "Do something");
      record("proj-1", "sess-1", "Do something else");

      const sess = db
        .prepare("SELECT prompt_count FROM _sessions WHERE id = ?")
        .get("sess-1") as { prompt_count: number };
      expect(sess.prompt_count).toBe(2);
    });

    it("records agent when provided", () => {
      const result = record("proj-1", null, "hello", "copilot");
      expect(result!.agent).toBe("copilot");
    });

    it("stores null agent when not provided", () => {
      const result = record("proj-1", null, "hello");
      expect(result!.agent).toBeNull();
    });
  });

  describe("list", () => {
    it("returns prompts for a given project ordered by created_at DESC", () => {
      record("proj-1", null, "First prompt");
      record("proj-1", null, "Second prompt");
      record("proj-2", null, "Other project");

      const prompts = list("proj-1");
      expect(prompts).toHaveLength(2);
      // Most recent first
      expect(prompts[0].promptPreview).toBe("Second prompt");
      expect(prompts[1].promptPreview).toBe("First prompt");
    });

    it("respects limit and offset", () => {
      for (let i = 0; i < 5; i++) {
        record("proj-1", null, `Prompt ${i}`);
      }

      const page1 = list("proj-1", 2, 0);
      expect(page1).toHaveLength(2);

      const page2 = list("proj-1", 2, 2);
      expect(page2).toHaveLength(2);

      const page3 = list("proj-1", 2, 4);
      expect(page3).toHaveLength(1);
    });

    it("returns empty array for unknown project", () => {
      const prompts = list("nonexistent");
      expect(prompts).toHaveLength(0);
    });
  });

  describe("analytics", () => {
    it("returns total count and breakdown by category", () => {
      record("proj-1", null, "Fix this bug");
      record("proj-1", null, "Fix another error");
      record("proj-1", null, "Add new feature");
      record("proj-1", null, "hello world");

      const stats = analytics("proj-1");
      expect(stats.total).toBe(4);
      expect(stats.byCategory["bug-fix"]).toBe(2);
      expect(stats.byCategory["feature"]).toBe(1);
      expect(stats.byCategory["general"]).toBe(1);
    });

    it("counts recent prompts within last 7 days", () => {
      record("proj-1", null, "Recent prompt");

      const stats = analytics("proj-1");
      expect(stats.recentCount).toBe(1);
    });

    it("returns zeros for unknown project", () => {
      const stats = analytics("nonexistent");
      expect(stats.total).toBe(0);
      expect(stats.byCategory).toEqual({});
      expect(stats.recentCount).toBe(0);
    });
  });

  describe("search", () => {
    it("falls back to LIKE search when FTS table does not exist", () => {
      record("proj-1", null, "Fix the authentication bug");
      record("proj-1", null, "Add dark mode feature");

      const results = search("proj-1", "authentication");
      expect(results).toHaveLength(1);
      expect(results[0].promptPreview).toContain("authentication");
    });

    it("returns empty for empty query", () => {
      record("proj-1", null, "Some prompt");
      const results = search("proj-1", "");
      expect(results).toHaveLength(0);
    });

    it("sanitizes special characters from query", () => {
      record("proj-1", null, "Fix the login bug");
      // Special chars " and * are stripped; the LIKE fallback should still match
      const results = search("proj-1", "login");
      expect(results).toHaveLength(1);
    });

    it("returns empty for no matches", () => {
      record("proj-1", null, "Fix the login bug");
      const results = search("proj-1", "zzzznotfound");
      expect(results).toHaveLength(0);
    });
  });

  describe("purgeOld", () => {
    it("deletes prompts older than the specified days", () => {
      // Insert a prompt with an old timestamp
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(
        "INSERT INTO _prompts (id, project_id, prompt_preview, intent_category, context_injected, created_at) VALUES (?, ?, ?, ?, 0, ?)",
      ).run("old-1", "proj-1", "Old prompt", "general", oldDate);

      // Insert a recent prompt
      record("proj-1", null, "Recent prompt");

      const deleted = purgeOld(30);
      expect(deleted).toBe(1);

      const remaining = db.prepare("SELECT COUNT(*) as cnt FROM _prompts").get() as { cnt: number };
      expect(remaining.cnt).toBe(1);
    });

    it("returns 0 when nothing to purge", () => {
      record("proj-1", null, "Recent prompt");
      const deleted = purgeOld(30);
      expect(deleted).toBe(0);
    });
  });

  describe("getStats", () => {
    it("returns count and byCategory", () => {
      record("proj-1", null, "Fix this bug");
      record("proj-1", null, "Add feature");

      const stats = getStats("proj-1");
      expect(stats.count).toBe(2);
      expect(stats.byCategory["bug-fix"]).toBe(1);
      expect(stats.byCategory["feature"]).toBe(1);
    });
  });
});
