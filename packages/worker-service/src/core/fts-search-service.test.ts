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

import {
  searchPrompts,
  searchObservations,
  searchErrors,
  searchSessions,
  searchAll,
} from "./fts-search-service.js";

function createTablesWithFts() {
  db.exec(`
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

    -- FTS5 virtual tables
    CREATE VIRTUAL TABLE IF NOT EXISTS _prompts_fts USING fts5(
      id UNINDEXED,
      project_id UNINDEXED,
      prompt_preview,
      intent_category,
      content=_prompts,
      content_rowid=rowid,
      tokenize='porter unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS _observations_fts USING fts5(
      id UNINDEXED,
      project_id UNINDEXED,
      content,
      category,
      content=_observations,
      content_rowid=rowid,
      tokenize='porter unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS _agent_errors_fts USING fts5(
      id UNINDEXED,
      project_id UNINDEXED,
      message,
      content=_agent_errors,
      content_rowid=rowid,
      tokenize='porter unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS _sessions_fts USING fts5(
      id UNINDEXED,
      project_id UNINDEXED,
      agent,
      summary,
      content=_sessions,
      content_rowid=rowid,
      tokenize='porter unicode61'
    );

    -- Sync triggers
    CREATE TRIGGER IF NOT EXISTS _prompts_fts_insert AFTER INSERT ON _prompts BEGIN
      INSERT INTO _prompts_fts(rowid, id, project_id, prompt_preview, intent_category)
      VALUES (new.rowid, new.id, new.project_id, new.prompt_preview, new.intent_category);
    END;

    CREATE TRIGGER IF NOT EXISTS _obs_fts_insert AFTER INSERT ON _observations BEGIN
      INSERT INTO _observations_fts(rowid, id, project_id, content, category)
      VALUES (new.rowid, new.id, new.project_id, new.content, new.category);
    END;

    CREATE TRIGGER IF NOT EXISTS _errors_fts_insert AFTER INSERT ON _agent_errors BEGIN
      INSERT INTO _agent_errors_fts(rowid, id, project_id, message)
      VALUES (new.rowid, new.id, new.project_id, new.message);
    END;

    CREATE TRIGGER IF NOT EXISTS _sessions_fts_insert AFTER INSERT ON _sessions BEGIN
      INSERT INTO _sessions_fts(rowid, id, project_id, agent, summary)
      VALUES (new.rowid, new.id, new.project_id, new.agent, new.summary);
    END;
  `);
}

function createTablesWithoutFts() {
  db.exec(`
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
  `);
}

const now = new Date().toISOString();

function insertPrompt(id: string, projectId: string, preview: string) {
  db.prepare(
    "INSERT INTO _prompts (id, project_id, prompt_preview, intent_category, created_at) VALUES (?, ?, ?, 'general', ?)",
  ).run(id, projectId, preview, now);
}

function insertObservation(id: string, projectId: string, content: string) {
  db.prepare(
    "INSERT INTO _observations (id, project_id, content, source, category, confidence, active, injection_count, created_at, updated_at) VALUES (?, ?, ?, 'user', 'general', 1.0, 1, 0, ?, ?)",
  ).run(id, projectId, content, now, now);
}

function insertError(id: string, projectId: string, message: string) {
  db.prepare(
    "INSERT INTO _agent_errors (id, project_id, message, fingerprint, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, projectId, message, `fp-${id}`, now);
}

function insertSession(id: string, projectId: string, agent: string, summary: string | null) {
  db.prepare(
    "INSERT INTO _sessions (id, project_id, started_at, agent, status, summary) VALUES (?, ?, ?, ?, 'ended', ?)",
  ).run(id, projectId, now, agent, summary);
}

describe("fts-search-service", () => {
  describe("with FTS5 tables", () => {
    beforeEach(() => {
      db = new Database(":memory:");
      db.pragma("journal_mode = WAL");
      createTablesWithFts();
    });

    describe("searchPrompts", () => {
      it("finds prompts matching search query via FTS", () => {
        insertPrompt("p-1", "proj-1", "Fix the authentication bug in login");
        insertPrompt("p-2", "proj-1", "Add dark mode toggle");
        insertPrompt("p-3", "proj-2", "Fix authentication in other project");

        const results = searchPrompts("proj-1", "authentication");
        expect(results).toHaveLength(1);
        expect(results[0].table).toBe("prompts");
        expect(results[0].id).toBe("p-1");
        expect(results[0].projectId).toBe("proj-1");
        expect(results[0].preview).toContain("authentication");
      });

      it("returns empty for empty query", () => {
        insertPrompt("p-1", "proj-1", "Some prompt");
        expect(searchPrompts("proj-1", "")).toEqual([]);
      });

      it("sanitizes special characters", () => {
        insertPrompt("p-1", "proj-1", "Fix the login bug");
        const results = searchPrompts("proj-1", '"login"');
        expect(results).toHaveLength(1);
      });

      it("respects limit parameter", () => {
        for (let i = 0; i < 5; i++) {
          insertPrompt(`p-${i}`, "proj-1", `Authentication problem number ${i}`);
        }
        const results = searchPrompts("proj-1", "authentication", 2);
        expect(results).toHaveLength(2);
      });

      it("returns empty for no matches", () => {
        insertPrompt("p-1", "proj-1", "Fix the login bug");
        expect(searchPrompts("proj-1", "zzzznotfound")).toEqual([]);
      });
    });

    describe("searchObservations", () => {
      it("finds observations matching search query via FTS", () => {
        insertObservation("o-1", "proj-1", "Always use TypeScript strict mode");
        insertObservation("o-2", "proj-1", "Prefer functional components");

        const results = searchObservations("proj-1", "TypeScript");
        expect(results).toHaveLength(1);
        expect(results[0].table).toBe("observations");
        expect(results[0].preview).toContain("TypeScript");
      });

      it("returns empty for empty query", () => {
        expect(searchObservations("proj-1", "")).toEqual([]);
      });
    });

    describe("searchErrors", () => {
      it("finds errors matching search query via FTS", () => {
        insertError("e-1", "proj-1", "TypeError: Cannot read property of undefined");
        insertError("e-2", "proj-1", "ReferenceError: foo is not defined");

        const results = searchErrors("proj-1", "TypeError");
        expect(results).toHaveLength(1);
        expect(results[0].table).toBe("errors");
        expect(results[0].preview).toContain("TypeError");
      });

      it("returns empty for empty query", () => {
        expect(searchErrors("proj-1", "")).toEqual([]);
      });
    });

    describe("searchSessions", () => {
      it("finds sessions matching search query via FTS", () => {
        insertSession("s-1", "proj-1", "claude", "Refactored authentication module");
        insertSession("s-2", "proj-1", "copilot", "Added unit tests for parser");

        const results = searchSessions("proj-1", "authentication");
        expect(results).toHaveLength(1);
        expect(results[0].table).toBe("sessions");
        expect(results[0].preview).toContain("authentication");
      });

      it("returns empty for empty query", () => {
        expect(searchSessions("proj-1", "")).toEqual([]);
      });
    });

    describe("searchAll", () => {
      it("searches across all tables", () => {
        insertPrompt("p-1", "proj-1", "Fix the authentication bug");
        insertObservation("o-1", "proj-1", "Authentication requires MFA");
        insertError("e-1", "proj-1", "Authentication failed with 401");
        insertSession("s-1", "proj-1", "claude", "Fixed authentication flow");

        const results = searchAll("proj-1", "authentication");
        expect(results.length).toBeGreaterThanOrEqual(4);
      });

      it("respects overall limit", () => {
        for (let i = 0; i < 10; i++) {
          insertPrompt(`p-${i}`, "proj-1", `Authentication issue ${i}`);
        }

        const results = searchAll("proj-1", "authentication", 5);
        expect(results.length).toBeLessThanOrEqual(5);
      });

      it("returns empty for empty query", () => {
        expect(searchAll("proj-1", "")).toEqual([]);
      });
    });
  });

  describe("LIKE fallback (without FTS tables)", () => {
    beforeEach(() => {
      db = new Database(":memory:");
      db.pragma("journal_mode = WAL");
      createTablesWithoutFts();
    });

    it("falls back to LIKE search for prompts", () => {
      insertPrompt("p-1", "proj-1", "Fix the authentication bug");
      insertPrompt("p-2", "proj-1", "Add dark mode");

      const results = searchPrompts("proj-1", "authentication");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("p-1");
    });

    it("falls back to LIKE search for observations", () => {
      insertObservation("o-1", "proj-1", "Always use TypeScript strict mode");

      const results = searchObservations("proj-1", "TypeScript");
      expect(results).toHaveLength(1);
    });

    it("falls back to LIKE search for errors", () => {
      insertError("e-1", "proj-1", "TypeError: Cannot read property");

      const results = searchErrors("proj-1", "TypeError");
      expect(results).toHaveLength(1);
    });

    it("falls back to LIKE search for sessions by summary", () => {
      insertSession("s-1", "proj-1", "claude", "Refactored authentication");

      const results = searchSessions("proj-1", "authentication");
      expect(results).toHaveLength(1);
    });

    it("falls back to LIKE search for sessions by agent", () => {
      insertSession("s-1", "proj-1", "claude", "Did some work");

      const results = searchSessions("proj-1", "claude");
      expect(results).toHaveLength(1);
    });
  });
});
