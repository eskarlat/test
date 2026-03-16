import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

vi.mock("../core/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../core/event-bus.js", () => ({
  eventBus: { publish: vi.fn(), subscribe: vi.fn() },
}));

vi.mock("../core/observations-service.js", () => ({
  getForInjection: vi.fn().mockReturnValue([]),
  markInjected: vi.fn(),
}));

vi.mock("../core/tool-governance.js", () => ({
  listRules: vi.fn().mockReturnValue([]),
}));

let db: InstanceType<typeof Database>;

vi.mock("../core/db-manager.js", () => ({
  dbManager: {
    getConnection: () => db,
  },
}));

import { recordStart, recordStop, list, getTree, analytics } from "./subagent-tracking.js";
import { listRules } from "./tool-governance.js";
import { getForInjection } from "./observations-service.js";

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _subagent_events (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      project_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      agent_type TEXT,
      parent_agent_id TEXT,
      duration_ms INTEGER,
      guidelines TEXT,
      block_decision TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subagent_project ON _subagent_events (project_id, created_at);

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

describe("subagent-tracking", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    createTables();
    vi.clearAllMocks();
  });

  describe("recordStart", () => {
    it("inserts a start event and returns eventId + guidelines", () => {
      const result = recordStart("proj-1", "sess-1", "code-review");
      expect(result.eventId).toBeTruthy();
      expect(result.guidelines).toContain("Subagent Guidelines");

      // Verify in DB
      const row = db
        .prepare("SELECT * FROM _subagent_events WHERE id = ?")
        .get(result.eventId) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.event_type).toBe("start");
      expect(row.agent_type).toBe("code-review");
      expect(row.project_id).toBe("proj-1");
      expect(row.session_id).toBe("sess-1");
    });

    it("includes deny rules in guidelines when available", () => {
      vi.mocked(listRules).mockReturnValue([
        {
          id: "rule-1",
          pattern: "rm -rf",
          decision: "deny",
          toolType: "bash",
          reason: "Dangerous",
          priority: 100,
          scope: "project",
          projectId: "proj-1",
          enabled: true,
          hitCount: 0,
          createdAt: new Date().toISOString(),
        },
      ]);

      const result = recordStart("proj-1", null, "subagent");
      expect(result.guidelines).toContain("Tool Restrictions");
      expect(result.guidelines).toContain("DENY: rm -rf");
      expect(result.guidelines).toContain("Dangerous");
    });

    it("includes observations in guidelines when available", () => {
      vi.mocked(getForInjection).mockReturnValue([
        {
          id: "obs-1",
          projectId: "proj-1",
          content: "Always use TypeScript strict mode",
          source: "user",
          category: "convention",
          confidence: 1.0,
          active: true,
          lastInjectedAt: null,
          injectionCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const result = recordStart("proj-1", null, "subagent");
      expect(result.guidelines).toContain("Project Observations");
      expect(result.guidelines).toContain("Always use TypeScript strict mode");
    });

    it("stores parent agent id when provided", () => {
      const parent = recordStart("proj-1", "sess-1", "parent-agent");
      const child = recordStart("proj-1", "sess-1", "child-agent", parent.eventId);

      const row = db
        .prepare("SELECT * FROM _subagent_events WHERE id = ?")
        .get(child.eventId) as Record<string, unknown>;
      expect(row.parent_agent_id).toBe(parent.eventId);
    });
  });

  describe("recordStop", () => {
    it("inserts a stop event", () => {
      const start = recordStart("proj-1", "sess-1", "code-review");
      recordStop("proj-1", "sess-1", "code-review", start.eventId);

      const events = list("proj-1");
      expect(events).toHaveLength(2);

      const stopEvent = events.find((e) => e.eventType === "stop");
      expect(stopEvent).toBeDefined();
      expect(stopEvent!.agentType).toBe("code-review");
    });

    it("calculates duration from start event", () => {
      const start = recordStart("proj-1", "sess-1", "agent");
      // The stop happens almost immediately, so durationMs should be >= 0
      recordStop("proj-1", "sess-1", "agent", start.eventId);

      const events = list("proj-1");
      const stopEvent = events.find((e) => e.eventType === "stop");
      expect(stopEvent!.durationMs).not.toBeNull();
      expect(stopEvent!.durationMs!).toBeGreaterThanOrEqual(0);
    });

    it("records block decision when provided", () => {
      recordStop("proj-1", "sess-1", "agent", undefined, undefined, "blocked-by-policy");

      const events = list("proj-1");
      expect(events[0].blockDecision).toBe("blocked-by-policy");
    });

    it("handles stop without start gracefully", () => {
      // No start event exists - should still work
      expect(() => recordStop("proj-1", null, "agent")).not.toThrow();

      const events = list("proj-1");
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe("stop");
      expect(events[0].durationMs).toBeNull();
    });
  });

  describe("list", () => {
    it("returns events for a project ordered by created_at DESC", () => {
      recordStart("proj-1", null, "agent-a");
      recordStart("proj-1", null, "agent-b");
      recordStart("proj-2", null, "agent-c");

      const events = list("proj-1");
      expect(events).toHaveLength(2);
      expect(events[0].agentType).toBe("agent-b"); // most recent first
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        recordStart("proj-1", null, `agent-${i}`);
      }

      const events = list("proj-1", 2);
      expect(events).toHaveLength(2);
    });

    it("returns empty for unknown project", () => {
      expect(list("nonexistent")).toHaveLength(0);
    });
  });

  describe("getTree", () => {
    it("builds a tree of parent-child subagent events", () => {
      const parent = recordStart("proj-1", "sess-1", "orchestrator");
      recordStart("proj-1", "sess-1", "worker-1", parent.eventId);
      recordStart("proj-1", "sess-1", "worker-2", parent.eventId);

      const tree = getTree("proj-1", "sess-1");
      expect(tree).toHaveLength(1); // one root
      expect(tree[0].agentType).toBe("orchestrator");
      expect(tree[0].children).toHaveLength(2);
    });

    it("returns multiple roots when no parent relationship", () => {
      recordStart("proj-1", "sess-1", "agent-a");
      recordStart("proj-1", "sess-1", "agent-b");

      const tree = getTree("proj-1", "sess-1");
      expect(tree).toHaveLength(2);
    });

    it("returns empty for session with no events", () => {
      expect(getTree("proj-1", "nonexistent")).toHaveLength(0);
    });

    it("only includes start events in tree", () => {
      const start = recordStart("proj-1", "sess-1", "agent");
      recordStop("proj-1", "sess-1", "agent", start.eventId);

      const tree = getTree("proj-1", "sess-1");
      expect(tree).toHaveLength(1);
      expect(tree[0].eventType).toBe("start");
    });
  });

  describe("analytics", () => {
    it("returns breakdown by agent type and total count", () => {
      recordStart("proj-1", null, "code-review");
      recordStart("proj-1", null, "code-review");
      recordStart("proj-1", null, "test-gen");

      const stats = analytics("proj-1");
      expect(stats.total).toBe(3);
      expect(stats.byType["code-review"]).toBe(2);
      expect(stats.byType["test-gen"]).toBe(1);
    });

    it("calculates average duration from stop events", () => {
      // Insert stop events with known durations
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO _subagent_events (id, project_id, event_type, agent_type, duration_ms, created_at) VALUES (?, ?, 'stop', ?, ?, ?)",
      ).run("s1", "proj-1", "agent", 100, now);
      db.prepare(
        "INSERT INTO _subagent_events (id, project_id, event_type, agent_type, duration_ms, created_at) VALUES (?, ?, 'stop', ?, ?, ?)",
      ).run("s2", "proj-1", "agent", 200, now);

      const stats = analytics("proj-1");
      expect(stats.avgDuration).toBe(150);
    });

    it("returns zeros for unknown project", () => {
      const stats = analytics("nonexistent");
      expect(stats).toEqual({ byType: {}, avgDuration: 0, total: 0 });
    });

    it("returns avgDuration 0 when no stop events have duration", () => {
      recordStart("proj-1", null, "agent");

      const stats = analytics("proj-1");
      expect(stats.avgDuration).toBe(0);
    });
  });
});
