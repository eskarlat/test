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
  create,
  list,
  updateObservation,
  archiveObservation,
  deleteObservation,
  confirmFromExtension,
  detectFromPrompt,
  getForInjection,
  markInjected,
  archiveStale,
  getObservationStats,
} from "./observations-service.js";
import { eventBus } from "./event-bus.js";

function createTables() {
  db.exec(`
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
  `);
}

describe("observations-service", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    createTables();
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("creates an observation and returns it", () => {
      const obs = create("proj-1", "Always use strict mode", "user", "coding", 0.9);
      expect(obs).not.toBeNull();
      expect(obs!.projectId).toBe("proj-1");
      expect(obs!.content).toBe("Always use strict mode");
      expect(obs!.source).toBe("user");
      expect(obs!.category).toBe("coding");
      expect(obs!.confidence).toBe(0.9);
      expect(obs!.active).toBe(true);
      expect(obs!.injectionCount).toBe(0);
    });

    it("publishes observation:created event", () => {
      const obs = create("proj-1", "Test observation", "user", "general");
      expect(eventBus.publish).toHaveBeenCalledWith("observation:created", {
        projectId: "proj-1",
        observationId: obs!.id,
      });
    });

    it("deduplicates exact matching content", () => {
      create("proj-1", "Always use path.join for paths", "user", "general");
      const dup = create("proj-1", "Always use path.join for paths", "user", "general");
      expect(dup).toBeNull();
    });

    it("deduplicates when new content is a substring of existing (> 20 chars)", () => {
      create("proj-1", "Always use path.join for file paths in Node.js", "user", "general");
      const dup = create("proj-1", "Always use path.join for file paths", "user", "general");
      expect(dup).toBeNull();
    });

    it("does not deduplicate short substring matches", () => {
      create("proj-1", "use strict", "user", "general");
      const obs = create("proj-1", "use strict mode everywhere in the codebase", "user", "general");
      // "use strict" is only 10 chars, below the 20-char threshold
      expect(obs).not.toBeNull();
    });

    it("allows different content for the same project", () => {
      const o1 = create("proj-1", "Observation one is unique", "user", "general");
      const o2 = create("proj-1", "Observation two is different", "user", "general");
      expect(o1).not.toBeNull();
      expect(o2).not.toBeNull();
    });
  });

  describe("list", () => {
    it("returns active observations for a project", () => {
      create("proj-1", "Active observation number one", "user", "general");
      create("proj-1", "Another active observation two", "user", "coding");

      const obs = list("proj-1");
      expect(obs).toHaveLength(2);
    });

    it("filters out inactive observations when activeOnly is true", () => {
      const obs = create("proj-1", "Will be archived observation", "user", "general");
      archiveObservation(obs!.id);

      const active = list("proj-1", true);
      expect(active).toHaveLength(0);
    });

    it("includes inactive observations when activeOnly is false", () => {
      const obs = create("proj-1", "Will be archived observation", "user", "general");
      archiveObservation(obs!.id);

      const all = list("proj-1", false);
      expect(all).toHaveLength(1);
      expect(all[0].active).toBe(false);
    });

    it("returns empty array for unknown project", () => {
      expect(list("nonexistent")).toEqual([]);
    });
  });

  describe("updateObservation", () => {
    it("updates content of an observation", () => {
      const obs = create("proj-1", "Original content for testing", "user", "general");
      const updated = updateObservation(obs!.id, { content: "Updated content for testing" });
      expect(updated).not.toBeNull();
      expect(updated!.content).toBe("Updated content for testing");
    });

    it("updates category", () => {
      const obs = create("proj-1", "Some observation for testing", "user", "general");
      const updated = updateObservation(obs!.id, { category: "coding" });
      expect(updated!.category).toBe("coding");
    });

    it("updates confidence", () => {
      const obs = create("proj-1", "Some observation for testing", "user", "general");
      const updated = updateObservation(obs!.id, { confidence: 0.5 });
      expect(updated!.confidence).toBe(0.5);
    });

    it("updates active status", () => {
      const obs = create("proj-1", "Some observation for testing", "user", "general");
      const updated = updateObservation(obs!.id, { active: false });
      expect(updated!.active).toBe(false);
    });

    it("returns null when no updates provided", () => {
      const obs = create("proj-1", "Some observation for testing", "user", "general");
      const result = updateObservation(obs!.id, {});
      expect(result).toBeNull();
    });

    it("returns null for non-existent observation", () => {
      const result = updateObservation("non-existent", { content: "test" });
      expect(result).toBeNull();
    });

    it("publishes observation:updated event", () => {
      const obs = create("proj-1", "Some observation for testing", "user", "general");
      vi.clearAllMocks();
      updateObservation(obs!.id, { content: "Changed content for testing" });
      expect(eventBus.publish).toHaveBeenCalledWith("observation:updated", {
        projectId: "proj-1",
        observationId: obs!.id,
      });
    });
  });

  describe("archiveObservation", () => {
    it("sets active to false", () => {
      const obs = create("proj-1", "Will be archived observation", "user", "general");
      const archived = archiveObservation(obs!.id);
      expect(archived).not.toBeNull();
      expect(archived!.active).toBe(false);
    });
  });

  describe("deleteObservation", () => {
    it("deletes an observation and returns it", () => {
      const obs = create("proj-1", "Will be deleted observation", "user", "general");
      const deleted = deleteObservation(obs!.id);
      expect(deleted).not.toBeNull();
      expect(deleted!.id).toBe(obs!.id);

      const remaining = list("proj-1");
      expect(remaining).toHaveLength(0);
    });

    it("publishes observation:deleted event", () => {
      const obs = create("proj-1", "Will be deleted observation", "user", "general");
      vi.clearAllMocks();
      deleteObservation(obs!.id);
      expect(eventBus.publish).toHaveBeenCalledWith("observation:deleted", {
        projectId: "proj-1",
        observationId: obs!.id,
      });
    });

    it("returns null for non-existent observation", () => {
      expect(deleteObservation("non-existent")).toBeNull();
    });
  });

  describe("confirmFromExtension", () => {
    it("creates observation with extension defaults", () => {
      const obs = confirmFromExtension("proj-1", { content: "Extension observation content here" });
      expect(obs).not.toBeNull();
      expect(obs!.source).toBe("extension");
      expect(obs!.category).toBe("general");
      expect(obs!.confidence).toBe(1.0);
    });

    it("uses provided source and category", () => {
      const obs = confirmFromExtension("proj-1", {
        content: "Custom extension observation content",
        source: "my-ext",
        category: "performance",
        confidence: 0.8,
      });
      expect(obs!.source).toBe("my-ext");
      expect(obs!.category).toBe("performance");
      expect(obs!.confidence).toBe(0.8);
    });
  });

  describe("detectFromPrompt", () => {
    it("detects observations from prompts with remember keyword", () => {
      detectFromPrompt("proj-1", "Please remember to always use TypeScript strict mode in this project");

      const obs = list("proj-1");
      expect(obs.length).toBeGreaterThanOrEqual(1);
      expect(obs[0].source).toBe("auto-detect");
      expect(obs[0].confidence).toBe(0.7);
    });

    it("does not create observations for prompts without remember-like keywords", () => {
      detectFromPrompt("proj-1", "Fix the login bug in the auth module");

      const obs = list("proj-1");
      expect(obs).toHaveLength(0);
    });

    it("ignores short sentences even with keywords", () => {
      detectFromPrompt("proj-1", "remember x");

      const obs = list("proj-1");
      expect(obs).toHaveLength(0);
    });

    it("detects multiple observations from multi-sentence prompts", () => {
      detectFromPrompt(
        "proj-1",
        "Always use path.join for file operations. Never use console.log in production code.",
      );

      const obs = list("proj-1");
      expect(obs).toHaveLength(2);
    });
  });

  describe("getForInjection", () => {
    it("returns active observations ordered by confidence DESC", () => {
      create("proj-1", "High confidence observation data", "user", "general", 1.0);
      create("proj-1", "Low confidence observation data", "user", "general", 0.5);

      const obs = getForInjection("proj-1");
      expect(obs).toHaveLength(2);
      expect(obs[0].confidence).toBe(1.0);
      expect(obs[1].confidence).toBe(0.5);
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        create("proj-1", `Observation number ${i} with enough length`, "user", "general");
      }

      const obs = getForInjection("proj-1", 3);
      expect(obs).toHaveLength(3);
    });
  });

  describe("markInjected", () => {
    it("increments injection_count and sets last_injected_at", () => {
      const obs = create("proj-1", "Will be injected observation", "user", "general");
      markInjected([obs!.id]);

      const row = db.prepare("SELECT injection_count, last_injected_at FROM _observations WHERE id = ?").get(obs!.id) as {
        injection_count: number;
        last_injected_at: string;
      };
      expect(row.injection_count).toBe(1);
      expect(row.last_injected_at).toBeTruthy();
    });

    it("handles empty array gracefully", () => {
      expect(() => markInjected([])).not.toThrow();
    });

    it("marks multiple observations at once", () => {
      const o1 = create("proj-1", "First observation for injection", "user", "general");
      const o2 = create("proj-1", "Second observation for injection", "user", "general");
      markInjected([o1!.id, o2!.id]);

      const rows = db.prepare("SELECT injection_count FROM _observations WHERE injection_count > 0").all();
      expect(rows).toHaveLength(2);
    });
  });

  describe("archiveStale", () => {
    it("archives observations not injected for 30+ days", () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(
        `INSERT INTO _observations (id, project_id, content, source, category, confidence, active, injection_count, last_injected_at, created_at, updated_at)
         VALUES (?, ?, ?, 'user', 'general', 1.0, 1, 1, ?, ?, ?)`,
      ).run("old-obs", "proj-1", "Old observation", oldDate, oldDate, oldDate);

      const count = archiveStale();
      expect(count).toBe(1);

      const row = db.prepare("SELECT active FROM _observations WHERE id = ?").get("old-obs") as { active: number };
      expect(row.active).toBe(0);
    });

    it("archives observations never injected and older than 30 days", () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(
        `INSERT INTO _observations (id, project_id, content, source, category, confidence, active, injection_count, created_at, updated_at)
         VALUES (?, ?, ?, 'user', 'general', 1.0, 1, 0, ?, ?)`,
      ).run("never-injected", "proj-1", "Never injected obs", oldDate, oldDate);

      const count = archiveStale();
      expect(count).toBe(1);
    });

    it("does not archive recently injected observations", () => {
      const recent = new Date().toISOString();
      db.prepare(
        `INSERT INTO _observations (id, project_id, content, source, category, confidence, active, injection_count, last_injected_at, created_at, updated_at)
         VALUES (?, ?, ?, 'user', 'general', 1.0, 1, 1, ?, ?, ?)`,
      ).run("recent-obs", "proj-1", "Recent observation", recent, recent, recent);

      const count = archiveStale();
      expect(count).toBe(0);
    });
  });

  describe("getObservationStats", () => {
    it("returns count and breakdown by category", () => {
      create("proj-1", "General observation one testing", "user", "general");
      create("proj-1", "Coding observation one testing", "user", "coding");
      create("proj-1", "Coding observation two testing", "user", "coding");

      const stats = getObservationStats("proj-1");
      expect(stats.count).toBe(3);
      expect(stats.byCategory.general).toBe(1);
      expect(stats.byCategory.coding).toBe(2);
    });

    it("returns zeros for unknown project", () => {
      const stats = getObservationStats("nonexistent");
      expect(stats.count).toBe(0);
      expect(stats.byCategory).toEqual({});
    });
  });
});
