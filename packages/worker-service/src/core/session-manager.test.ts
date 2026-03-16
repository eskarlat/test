import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

vi.mock("../core/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let db: InstanceType<typeof Database>;

vi.mock("../core/db-manager.js", () => ({
  dbManager: {
    getConnection: () => db,
  },
}));

import { createSession, endSession, listActiveSessions } from "./session-manager.js";

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
  `);
}

describe("session-manager", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    createTables();
  });

  describe("createSession", () => {
    it("inserts a new active session and returns it", () => {
      const session = createSession("proj-1", "claude");
      expect(session).toBeDefined();
      expect(session.projectId).toBe("proj-1");
      expect(session.agent).toBe("claude");
      expect(session.status).toBe("active");
      expect(session.id).toBeTruthy();
      expect(session.startedAt).toBeTruthy();

      // Verify it's in the DB
      const row = db
        .prepare("SELECT * FROM _sessions WHERE id = ?")
        .get(session.id) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.project_id).toBe("proj-1");
      expect(row.agent).toBe("claude");
      expect(row.status).toBe("active");
    });

    it("creates multiple sessions for the same project", () => {
      const s1 = createSession("proj-1", "claude");
      const s2 = createSession("proj-1", "copilot");
      expect(s1.id).not.toBe(s2.id);

      const count = db
        .prepare("SELECT COUNT(*) as cnt FROM _sessions WHERE project_id = ?")
        .get("proj-1") as { cnt: number };
      expect(count.cnt).toBe(2);
    });

    it("creates sessions for different projects", () => {
      createSession("proj-1", "claude");
      createSession("proj-2", "claude");

      const rows = db.prepare("SELECT * FROM _sessions").all();
      expect(rows).toHaveLength(2);
    });
  });

  describe("endSession", () => {
    it("marks a session as ended with summary", () => {
      const session = createSession("proj-1", "claude");
      endSession(session.id, "Fixed bug in auth module");

      const row = db
        .prepare("SELECT * FROM _sessions WHERE id = ?")
        .get(session.id) as Record<string, unknown>;
      expect(row.status).toBe("ended");
      expect(row.ended_at).toBeTruthy();
      expect(row.summary).toBe("Fixed bug in auth module");
    });

    it("marks a session as ended without summary", () => {
      const session = createSession("proj-1", "claude");
      endSession(session.id);

      const row = db
        .prepare("SELECT * FROM _sessions WHERE id = ?")
        .get(session.id) as Record<string, unknown>;
      expect(row.status).toBe("ended");
      expect(row.summary).toBeNull();
    });

    it("handles ending a non-existent session gracefully", () => {
      // Should not throw
      expect(() => endSession("non-existent-id", "test")).not.toThrow();
    });
  });

  describe("listActiveSessions", () => {
    it("returns only active sessions for a project", () => {
      const s1 = createSession("proj-1", "claude");
      const s2 = createSession("proj-1", "copilot");
      createSession("proj-2", "claude"); // different project
      endSession(s1.id, "done");

      const active = listActiveSessions("proj-1");
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(s2.id);
      expect(active[0].agent).toBe("copilot");
      expect(active[0].status).toBe("active");
    });

    it("returns empty array when no active sessions", () => {
      const s = createSession("proj-1", "claude");
      endSession(s.id);

      const active = listActiveSessions("proj-1");
      expect(active).toHaveLength(0);
    });

    it("returns sessions ordered by started_at DESC", () => {
      // Insert sessions with explicit timestamps to guarantee ordering
      const id1 = "sess-older";
      const id2 = "sess-newer";
      db.prepare(
        "INSERT INTO _sessions (id, project_id, started_at, agent, status) VALUES (?, ?, ?, ?, 'active')",
      ).run(id1, "proj-1", "2025-01-01T00:00:00.000Z", "agent-a");
      db.prepare(
        "INSERT INTO _sessions (id, project_id, started_at, agent, status) VALUES (?, ?, ?, ?, 'active')",
      ).run(id2, "proj-1", "2025-01-02T00:00:00.000Z", "agent-b");

      const active = listActiveSessions("proj-1");
      expect(active).toHaveLength(2);
      // Most recent first
      expect(active[0].id).toBe(id2);
      expect(active[1].id).toBe(id1);
    });

    it("returns empty array for unknown project", () => {
      const active = listActiveSessions("nonexistent");
      expect(active).toHaveLength(0);
    });

    it("maps column names correctly", () => {
      createSession("proj-1", "claude");
      const active = listActiveSessions("proj-1");
      expect(active[0]).toHaveProperty("projectId");
      expect(active[0]).toHaveProperty("startedAt");
      expect(active[0]).toHaveProperty("agent");
      expect(active[0]).toHaveProperty("status");
    });
  });
});
