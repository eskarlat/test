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
  getAnalytics,
  getSessionAnalytics,
  listUsage,
  listWarnings,
  getStats,
  purgeOld,
} from "./tool-analytics.js";

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

    CREATE TABLE IF NOT EXISTS _tool_usage (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      project_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_input TEXT,
      result_summary TEXT,
      file_path TEXT,
      duration_ms INTEGER,
      success INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tool_usage_project ON _tool_usage (project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tool_usage_session ON _tool_usage (session_id);
  `);
}

function insertSession(id: string, projectId: string) {
  db.prepare(
    "INSERT INTO _sessions (id, project_id, started_at, agent, status) VALUES (?, ?, ?, ?, 'active')",
  ).run(id, projectId, new Date().toISOString(), "claude");
}

describe("tool-analytics", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    createTables();
  });

  describe("record", () => {
    it("inserts a tool usage record and returns it", () => {
      const usage = record("proj-1", null, "bash", '{"command":"ls"}', "file1.ts\nfile2.ts", 100);
      expect(usage).not.toBeNull();
      expect(usage!.projectId).toBe("proj-1");
      expect(usage!.toolName).toBe("bash");
      expect(usage!.durationMs).toBe(100);
      expect(usage!.success).toBe(true);
    });

    it("extracts file path from tool input JSON", () => {
      const usage = record(
        "proj-1",
        null,
        "write",
        '{"path":"/home/user/test.ts"}',
        "OK",
      );
      expect(usage!.filePath).toBe("/home/user/test.ts");
    });

    it("extracts file_path key from tool input JSON", () => {
      const usage = record(
        "proj-1",
        null,
        "read",
        '{"file_path":"/home/user/foo.ts"}',
        "OK",
      );
      expect(usage!.filePath).toBe("/home/user/foo.ts");
    });

    it("sets filePath to null when no path in input", () => {
      const usage = record("proj-1", null, "bash", '{"command":"ls"}', "OK");
      expect(usage!.filePath).toBeNull();
    });

    it("truncates result summary to 200 chars + ellipsis", () => {
      const longResult = "x".repeat(300);
      const usage = record("proj-1", null, "bash", "{}", longResult);
      expect(usage!.resultSummary!.length).toBeLessThanOrEqual(203);
      expect(usage!.resultSummary!.endsWith("...")).toBe(true);
    });

    it("records failure when success=false", () => {
      const usage = record("proj-1", null, "bash", "{}", "error output", undefined, false);
      expect(usage!.success).toBe(false);
    });

    it("increments session tool_count when sessionId is provided", () => {
      insertSession("sess-1", "proj-1");

      record("proj-1", "sess-1", "bash", "{}", "OK");
      record("proj-1", "sess-1", "write", "{}", "OK");

      const sess = db
        .prepare("SELECT tool_count FROM _sessions WHERE id = ?")
        .get("sess-1") as { tool_count: number };
      expect(sess.tool_count).toBe(2);
    });

    it("updates session files_modified when file path is extracted", () => {
      insertSession("sess-1", "proj-1");

      record("proj-1", "sess-1", "write", '{"path":"/home/user/a.ts"}', "OK");
      record("proj-1", "sess-1", "write", '{"path":"/home/user/b.ts"}', "OK");
      // Duplicate path should not be added again
      record("proj-1", "sess-1", "write", '{"path":"/home/user/a.ts"}', "OK");

      const sess = db
        .prepare("SELECT files_modified FROM _sessions WHERE id = ?")
        .get("sess-1") as { files_modified: string };
      const files = JSON.parse(sess.files_modified) as string[];
      expect(files).toHaveLength(2);
      expect(files).toContain("/home/user/a.ts");
      expect(files).toContain("/home/user/b.ts");
    });
  });

  describe("getAnalytics", () => {
    it("returns aggregated analytics for a project", () => {
      record("proj-1", null, "bash", "{}", "OK", 100);
      record("proj-1", null, "bash", "{}", "OK", 200);
      record("proj-1", null, "write", '{"path":"/a.ts"}', "OK", 50);
      record("proj-1", null, "read", "{}", "error", undefined, false);

      const analytics = getAnalytics("proj-1");
      expect(analytics.totalCount).toBe(4);
      expect(analytics.byTool["bash"]).toBe(2);
      expect(analytics.byTool["write"]).toBe(1);
      expect(analytics.byTool["read"]).toBe(1);
      expect(analytics.successRate).toBe(0.75);
      expect(analytics.mostTouchedFiles).toHaveLength(1);
      expect(analytics.mostTouchedFiles[0].filePath).toBe("/a.ts");
    });

    it("returns defaults for unknown project", () => {
      const analytics = getAnalytics("nonexistent");
      expect(analytics.totalCount).toBe(0);
      expect(analytics.byTool).toEqual({});
      expect(analytics.successRate).toBe(1);
      expect(analytics.mostTouchedFiles).toHaveLength(0);
    });
  });

  describe("getSessionAnalytics", () => {
    it("returns analytics scoped to a session", () => {
      insertSession("sess-1", "proj-1");

      record("proj-1", "sess-1", "bash", "{}", "OK");
      record("proj-1", "sess-1", "write", '{"path":"/a.ts"}', "OK");
      record("proj-1", "sess-1", "write", '{"path":"/a.ts"}', "fail", undefined, false);

      const analytics = getSessionAnalytics("proj-1", "sess-1");
      expect(analytics.totalCount).toBe(3);
      expect(analytics.byTool["bash"]).toBe(1);
      expect(analytics.byTool["write"]).toBe(2);
      expect(analytics.fileHotspots).toHaveLength(1);
      expect(analytics.fileHotspots[0].filePath).toBe("/a.ts");
      expect(analytics.fileHotspots[0].count).toBe(2);
      // 2 out of 3 succeeded
      expect(analytics.successRate).toBeCloseTo(2 / 3, 2);
    });

    it("returns defaults for unknown session", () => {
      const analytics = getSessionAnalytics("proj-1", "nonexistent");
      expect(analytics.totalCount).toBe(0);
      expect(analytics.successRate).toBe(1);
    });
  });

  describe("listUsage", () => {
    it("returns tool usage for a project", () => {
      record("proj-1", null, "bash", "{}", "OK");
      record("proj-1", null, "write", "{}", "OK");
      record("proj-2", null, "bash", "{}", "OK");

      const usage = listUsage("proj-1");
      expect(usage).toHaveLength(2);
    });

    it("respects limit and offset", () => {
      for (let i = 0; i < 5; i++) {
        record("proj-1", null, "bash", "{}", `result-${i}`);
      }
      const page = listUsage("proj-1", 2, 0);
      expect(page).toHaveLength(2);
    });
  });

  describe("listWarnings", () => {
    it("returns failed tool usages", () => {
      record("proj-1", null, "bash", "{}", "OK", undefined, true);
      record("proj-1", null, "bash", "{}", "Command failed", undefined, false);
      record("proj-1", null, "write", "{}", "Permission denied", undefined, false);

      const warnings = listWarnings("proj-1");
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toHaveProperty("type");
      expect(warnings[0]).toHaveProperty("detail");
      expect(warnings[0]).toHaveProperty("createdAt");
    });

    it("returns empty for project with no failures", () => {
      record("proj-1", null, "bash", "{}", "OK");
      const warnings = listWarnings("proj-1");
      expect(warnings).toHaveLength(0);
    });
  });

  describe("getStats", () => {
    it("returns total and warning counts", () => {
      record("proj-1", null, "bash", "{}", "OK");
      record("proj-1", null, "bash", "{}", "OK");
      record("proj-1", null, "bash", "{}", "fail", undefined, false);

      const stats = getStats("proj-1");
      expect(stats.total).toBe(3);
      expect(stats.warnings).toBe(1);
    });

    it("returns zeros for unknown project", () => {
      const stats = getStats("nonexistent");
      expect(stats).toEqual({ total: 0, warnings: 0 });
    });
  });

  describe("purgeOld", () => {
    it("deletes tool usage older than specified days", () => {
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(
        "INSERT INTO _tool_usage (id, project_id, tool_name, tool_input, success, created_at) VALUES (?, ?, ?, ?, 1, ?)",
      ).run("old-1", "proj-1", "bash", "{}", oldDate);

      record("proj-1", null, "bash", "{}", "OK");

      const deleted = purgeOld(30);
      expect(deleted).toBe(1);

      const remaining = db.prepare("SELECT COUNT(*) as cnt FROM _tool_usage").get() as { cnt: number };
      expect(remaining.cnt).toBe(1);
    });
  });
});
