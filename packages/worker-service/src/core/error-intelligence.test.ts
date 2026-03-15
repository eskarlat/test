import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

vi.mock("../core/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../core/event-bus.js", () => ({
  eventBus: { publish: vi.fn(), subscribe: vi.fn() },
}));

vi.mock("../core/observations-service.js", () => ({
  create: vi.fn(),
}));

let db: InstanceType<typeof Database>;

vi.mock("../core/db-manager.js", () => ({
  dbManager: {
    getConnection: () => db,
  },
}));

import {
  record,
  listErrors,
  listPatterns,
  resolvePattern,
  ignorePattern,
  reactivateIfRecurring,
  getActiveWarnings,
  trends,
  purgeOld,
  getPatternStats,
} from "./error-intelligence.js";

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

    CREATE TABLE IF NOT EXISTS _agent_errors (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      project_id TEXT NOT NULL,
      error_type TEXT,
      message TEXT NOT NULL,
      stack TEXT,
      fingerprint TEXT NOT NULL,
      tool_name TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_errors_project ON _agent_errors (project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_errors_fingerprint ON _agent_errors (fingerprint);

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
  `);
}

describe("error-intelligence", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    createTables();
  });

  describe("record", () => {
    it("inserts an error and returns it", () => {
      const err = record("proj-1", null, "TypeError", "Cannot read property 'foo' of undefined");
      expect(err).not.toBeNull();
      expect(err!.projectId).toBe("proj-1");
      expect(err!.errorType).toBe("TypeError");
      expect(err!.message).toBe("Cannot read property 'foo' of undefined");
      expect(err!.fingerprint).toBeTruthy();
      expect(err!.createdAt).toBeTruthy();
    });

    it("creates an error pattern on first occurrence", () => {
      record("proj-1", null, "TypeError", "Cannot read property 'foo' of undefined");

      const patterns = listPatterns("proj-1");
      expect(patterns).toHaveLength(1);
      expect(patterns[0].occurrenceCount).toBe(1);
      expect(patterns[0].status).toBe("active");
    });

    it("increments pattern occurrence_count on repeated errors with same fingerprint", () => {
      record("proj-1", null, "TypeError", "Cannot read property 'foo' of undefined");
      record("proj-1", null, "TypeError", "Cannot read property 'foo' of undefined");

      const patterns = listPatterns("proj-1");
      expect(patterns).toHaveLength(1);
      expect(patterns[0].occurrenceCount).toBe(2);
    });

    it("stores stack trace and tool name when provided", () => {
      const err = record(
        "proj-1",
        null,
        "Error",
        "Something failed",
        "at line 42\nat line 10",
        "bash",
      );
      expect(err!.stack).toBe("at line 42\nat line 10");
      expect(err!.toolName).toBe("bash");
    });

    it("increments session error_count when sessionId is provided", () => {
      db.prepare(
        "INSERT INTO _sessions (id, project_id, started_at, agent, status) VALUES (?, ?, ?, ?, 'active')",
      ).run("sess-1", "proj-1", new Date().toISOString(), "claude");

      record("proj-1", "sess-1", "Error", "fail 1");
      record("proj-1", "sess-1", "Error", "fail 2");

      const sess = db
        .prepare("SELECT error_count FROM _sessions WHERE id = ?")
        .get("sess-1") as { error_count: number };
      expect(sess.error_count).toBe(2);
    });

    it("produces same fingerprint for same normalized message", () => {
      const e1 = record("proj-1", null, "Error", "File not found: /home/user/test.js");
      const e2 = record("proj-1", null, "Error", "File not found: /var/log/other.js");
      // Both messages normalize to the same template (paths replaced)
      expect(e1!.fingerprint).toBe(e2!.fingerprint);
    });

    it("produces different fingerprints for different messages", () => {
      const e1 = record("proj-1", null, "TypeError", "Cannot read property");
      const e2 = record("proj-1", null, "RangeError", "Array index out of bounds");
      expect(e1!.fingerprint).not.toBe(e2!.fingerprint);
    });

    it("reactivates resolved pattern when same error recurs", () => {
      const e1 = record("proj-1", null, "Error", "Something failed");
      resolvePattern(e1!.fingerprint, "Fixed");

      // Verify it's resolved
      let patterns = listPatterns("proj-1");
      expect(patterns[0].status).toBe("resolved");

      // Record same error again - should reactivate
      record("proj-1", null, "Error", "Something failed");
      patterns = listPatterns("proj-1");
      expect(patterns[0].status).toBe("active");
    });
  });

  describe("listErrors", () => {
    it("returns errors for a project ordered by created_at DESC", () => {
      record("proj-1", null, "Error", "First error");
      record("proj-1", null, "Error", "Second error");
      record("proj-2", null, "Error", "Other project");

      const errors = listErrors("proj-1");
      expect(errors).toHaveLength(2);
      expect(errors[0].message).toBe("Second error");
    });

    it("respects limit and offset", () => {
      for (let i = 0; i < 5; i++) {
        record("proj-1", null, "Error", `Error ${i}`);
      }

      const page = listErrors("proj-1", 2, 0);
      expect(page).toHaveLength(2);
    });

    it("returns empty for unknown project", () => {
      expect(listErrors("nonexistent")).toHaveLength(0);
    });
  });

  describe("listPatterns", () => {
    it("returns patterns ordered by occurrence_count DESC", () => {
      record("proj-1", null, "Error", "Rare error");
      record("proj-1", null, "Error", "Common error");
      record("proj-1", null, "Error", "Common error");
      record("proj-1", null, "Error", "Common error");

      const patterns = listPatterns("proj-1");
      expect(patterns).toHaveLength(2);
      expect(patterns[0].occurrenceCount).toBe(3);
    });
  });

  describe("resolvePattern", () => {
    it("marks a pattern as resolved with a note", () => {
      const err = record("proj-1", null, "Error", "Something failed");
      const result = resolvePattern(err!.fingerprint, "Fixed in PR #42");
      expect(result).toBe(true);

      const patterns = listPatterns("proj-1");
      expect(patterns[0].status).toBe("resolved");
      expect(patterns[0].resolveNote).toBe("Fixed in PR #42");
    });

    it("returns false for non-existent fingerprint", () => {
      const result = resolvePattern("nonexistent", "note");
      expect(result).toBe(false);
    });
  });

  describe("ignorePattern", () => {
    it("marks a pattern as ignored", () => {
      const err = record("proj-1", null, "Error", "Noisy warning");
      const result = ignorePattern(err!.fingerprint);
      expect(result).toBe(true);

      const patterns = listPatterns("proj-1");
      expect(patterns[0].status).toBe("ignored");
    });

    it("returns false for non-existent fingerprint", () => {
      expect(ignorePattern("nonexistent")).toBe(false);
    });
  });

  describe("reactivateIfRecurring", () => {
    it("reactivates a resolved pattern with >= 3 occurrences", () => {
      const err = record("proj-1", null, "Error", "Recurring issue");
      record("proj-1", null, "Error", "Recurring issue");
      record("proj-1", null, "Error", "Recurring issue");
      resolvePattern(err!.fingerprint, "Fixed");

      const result = reactivateIfRecurring(err!.fingerprint, "proj-1");
      expect(result).toBe(true);

      const patterns = listPatterns("proj-1");
      expect(patterns[0].status).toBe("active");
    });

    it("does not reactivate if occurrence count is less than 3", () => {
      const err = record("proj-1", null, "Error", "Rare issue");
      resolvePattern(err!.fingerprint, "Fixed");

      const result = reactivateIfRecurring(err!.fingerprint, "proj-1");
      expect(result).toBe(false);
    });

    it("returns false for non-existent fingerprint", () => {
      expect(reactivateIfRecurring("nonexistent", "proj-1")).toBe(false);
    });
  });

  describe("getActiveWarnings", () => {
    it("returns active patterns with >= 3 occurrences", () => {
      record("proj-1", null, "Error", "Frequent error");
      record("proj-1", null, "Error", "Frequent error");
      record("proj-1", null, "Error", "Frequent error");
      record("proj-1", null, "Error", "Rare error");

      const warnings = getActiveWarnings("proj-1");
      expect(warnings).toHaveLength(1);
      expect(warnings[0].occurrenceCount).toBe(3);
    });

    it("excludes resolved and ignored patterns", () => {
      const err = record("proj-1", null, "Error", "Resolved error");
      record("proj-1", null, "Error", "Resolved error");
      record("proj-1", null, "Error", "Resolved error");
      resolvePattern(err!.fingerprint, "Fixed");

      const warnings = getActiveWarnings("proj-1");
      expect(warnings).toHaveLength(0);
    });
  });

  describe("trends", () => {
    it("returns daily error counts for the last 14 days", () => {
      record("proj-1", null, "Error", "Today's error");
      record("proj-1", null, "Error", "Another today");

      const result = trends("proj-1");
      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(2);
      expect(result[0].day).toBeTruthy();
    });

    it("returns empty for project with no errors", () => {
      expect(trends("nonexistent")).toHaveLength(0);
    });
  });

  describe("purgeOld", () => {
    it("deletes errors older than the specified days", () => {
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(
        "INSERT INTO _agent_errors (id, project_id, error_type, message, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("old-1", "proj-1", "Error", "Old error", "fp1", oldDate);

      record("proj-1", null, "Error", "Recent error");

      const deleted = purgeOld(30);
      expect(deleted).toBe(1);
    });

    it("returns 0 when nothing to purge", () => {
      record("proj-1", null, "Error", "Recent error");
      expect(purgeOld(30)).toBe(0);
    });
  });

  describe("getPatternStats", () => {
    it("returns count, active count, and recent count", () => {
      record("proj-1", null, "Error", "Error A");
      record("proj-1", null, "Error", "Error B");
      const err = record("proj-1", null, "Error", "Error C");
      ignorePattern(err!.fingerprint);

      const stats = getPatternStats("proj-1");
      expect(stats.count).toBe(3);
      expect(stats.active).toBe(2);
      expect(stats.recent).toBe(3); // all created recently
    });

    it("returns zeros for unknown project", () => {
      const stats = getPatternStats("nonexistent");
      expect(stats).toEqual({ count: 0, active: 0, recent: 0 });
    });
  });
});
