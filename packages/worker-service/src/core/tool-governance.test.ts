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
  seedBuiltinRules,
  evaluate,
  addRule,
  updateRule,
  deleteRule,
  listRules,
  toggleRule,
  testPattern,
  getStats,
  listAuditLog,
} from "./tool-governance.js";

function createTables() {
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_tool_rules_scope ON _tool_rules (scope, enabled);

    CREATE TABLE IF NOT EXISTS _tool_audit (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      project_id TEXT NOT NULL,
      tool_type TEXT NOT NULL,
      tool_input TEXT,
      decision TEXT NOT NULL,
      rule_id TEXT,
      extension_name TEXT,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tool_audit_project ON _tool_audit (project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tool_audit_session ON _tool_audit (session_id);
  `);
}

describe("tool-governance", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    createTables();
  });

  describe("seedBuiltinRules", () => {
    it("creates builtin rules when they do not exist", () => {
      seedBuiltinRules();

      const rules = listRules("global");
      expect(rules.length).toBeGreaterThanOrEqual(3);

      const rmRf = rules.find((r) => r.id === "builtin-rm-rf");
      expect(rmRf).toBeDefined();
      expect(rmRf!.pattern).toBe("rm -rf");
      expect(rmRf!.decision).toBe("deny");
      expect(rmRf!.priority).toBe(100);
    });

    it("does not duplicate builtin rules on repeated calls", () => {
      seedBuiltinRules();
      seedBuiltinRules();

      const rules = listRules("global");
      const rmRfCount = rules.filter((r) => r.id === "builtin-rm-rf").length;
      expect(rmRfCount).toBe(1);
    });
  });

  describe("addRule", () => {
    it("creates a new rule and returns it", () => {
      const rule = addRule("proj-1", "DELETE FROM", "deny", "sql", "No deletes", "project");
      expect(rule.pattern).toBe("DELETE FROM");
      expect(rule.decision).toBe("deny");
      expect(rule.toolType).toBe("sql");
      expect(rule.reason).toBe("No deletes");
      expect(rule.scope).toBe("project");
      expect(rule.projectId).toBe("proj-1");
      expect(rule.enabled).toBe(true);
      expect(rule.hitCount).toBe(0);
    });

    it("creates a global rule with null projectId", () => {
      const rule = addRule(null, "sudo", "deny", "bash", "No sudo", "global");
      expect(rule.scope).toBe("global");
      expect(rule.projectId).toBeNull();
    });
  });

  describe("updateRule", () => {
    it("updates rule pattern", () => {
      const rule = addRule(null, "old-pattern", "deny", null, null, "global");
      const result = updateRule(rule.id, { pattern: "new-pattern" });
      expect(result).toBe(true);

      const updated = listRules("global").find((r) => r.id === rule.id);
      expect(updated!.pattern).toBe("new-pattern");
    });

    it("updates rule decision", () => {
      const rule = addRule(null, "test", "deny", null, null, "global");
      updateRule(rule.id, { decision: "allow" });

      const updated = listRules("global").find((r) => r.id === rule.id);
      expect(updated!.decision).toBe("allow");
    });

    it("updates multiple fields at once", () => {
      const rule = addRule(null, "test", "deny", null, null, "global");
      updateRule(rule.id, { pattern: "updated", reason: "new reason", priority: 50 });

      const updated = listRules("global").find((r) => r.id === rule.id);
      expect(updated!.pattern).toBe("updated");
      expect(updated!.reason).toBe("new reason");
      expect(updated!.priority).toBe(50);
    });

    it("returns false when no fields provided", () => {
      const rule = addRule(null, "test", "deny", null, null, "global");
      expect(updateRule(rule.id, {})).toBe(false);
    });

    it("returns false for non-existent rule", () => {
      expect(updateRule("nonexistent", { pattern: "x" })).toBe(false);
    });

    it("updates enabled state", () => {
      const rule = addRule(null, "test", "deny", null, null, "global");
      updateRule(rule.id, { enabled: false });

      const updated = listRules("global").find((r) => r.id === rule.id);
      expect(updated!.enabled).toBe(false);
    });
  });

  describe("deleteRule", () => {
    it("deletes an existing rule", () => {
      const rule = addRule(null, "test", "deny", null, null, "global");
      const result = deleteRule(rule.id);
      expect(result).toBe(true);

      const rules = listRules("global");
      expect(rules.find((r) => r.id === rule.id)).toBeUndefined();
    });

    it("returns false for non-existent rule", () => {
      expect(deleteRule("nonexistent")).toBe(false);
    });
  });

  describe("listRules", () => {
    it("returns all rules when no filter", () => {
      addRule(null, "global-rule", "deny", null, null, "global");
      addRule("proj-1", "project-rule", "deny", null, null, "project");

      const allRules = listRules();
      expect(allRules).toHaveLength(2);
    });

    it("filters by global scope", () => {
      addRule(null, "global-rule", "deny", null, null, "global");
      addRule("proj-1", "project-rule", "deny", null, null, "project");

      const globalRules = listRules("global");
      expect(globalRules).toHaveLength(1);
      expect(globalRules[0].scope).toBe("global");
    });

    it("includes global and project rules when projectId is provided", () => {
      addRule(null, "global-rule", "deny", null, null, "global");
      addRule("proj-1", "project-rule", "deny", null, null, "project");
      addRule("proj-2", "other-project-rule", "deny", null, null, "project");

      const rules = listRules(undefined, "proj-1");
      expect(rules).toHaveLength(2); // global + proj-1
    });

    it("returns rules ordered by priority DESC", () => {
      const r1 = addRule(null, "low-priority", "deny", null, null, "global");
      const r2 = addRule(null, "high-priority", "deny", null, null, "global");
      updateRule(r2.id, { priority: 50 });

      const rules = listRules("global");
      expect(rules[0].id).toBe(r2.id);
    });
  });

  describe("toggleRule", () => {
    it("toggles an enabled rule to disabled", () => {
      const rule = addRule(null, "test", "deny", null, null, "global");
      expect(rule.enabled).toBe(true);

      toggleRule(rule.id);
      let updated = listRules("global").find((r) => r.id === rule.id);
      expect(updated!.enabled).toBe(false);

      toggleRule(rule.id);
      updated = listRules("global").find((r) => r.id === rule.id);
      expect(updated!.enabled).toBe(true);
    });

    it("returns false for non-existent rule", () => {
      expect(toggleRule("nonexistent")).toBe(false);
    });
  });

  describe("evaluate", () => {
    it("returns allow when no rules match", () => {
      const result = evaluate("proj-1", null, "bash", "echo hello");
      expect(result.decision).toBe("allow");
    });

    it("denies when a deny rule matches", () => {
      seedBuiltinRules();

      const result = evaluate("proj-1", null, "bash", "rm -rf /");
      expect(result.decision).toBe("deny");
      expect(result.reason).toBe("Destructive recursive delete is not allowed");
      expect(result.ruleId).toBe("builtin-rm-rf");
    });

    it("denies DROP TABLE for sql tool type", () => {
      seedBuiltinRules();

      const result = evaluate("proj-1", null, "sql", "DROP TABLE users");
      expect(result.decision).toBe("deny");
    });

    it("increments hit_count when a rule matches", () => {
      seedBuiltinRules();

      evaluate("proj-1", null, "bash", "rm -rf /tmp");
      evaluate("proj-1", null, "bash", "rm -rf /var");

      const rule = listRules("global").find((r) => r.id === "builtin-rm-rf");
      expect(rule!.hitCount).toBe(2);
    });

    it("records audit entry for every evaluation", () => {
      seedBuiltinRules();

      evaluate("proj-1", "sess-1", "bash", "echo hello");
      evaluate("proj-1", "sess-1", "bash", "rm -rf /");

      const auditLog = listAuditLog("proj-1");
      expect(auditLog).toHaveLength(2);
    });

    it("does not match disabled rules", () => {
      const rule = addRule(null, "echo", "deny", "bash", "No echo", "global");
      toggleRule(rule.id); // disable

      const result = evaluate("proj-1", null, "bash", "echo hello");
      expect(result.decision).toBe("allow");
    });

    it("matches project-scoped rules", () => {
      addRule("proj-1", "dangerous", "deny", null, "Project rule", "project");

      const result = evaluate("proj-1", null, "bash", "dangerous command");
      expect(result.decision).toBe("deny");
      expect(result.reason).toBe("Project rule");
    });

    it("does not apply project rules to other projects", () => {
      addRule("proj-1", "dangerous", "deny", null, "Project rule", "project");

      const result = evaluate("proj-2", null, "bash", "dangerous command");
      expect(result.decision).toBe("allow");
    });

    it("higher priority rules take precedence", () => {
      const r1 = addRule(null, "test-cmd", "allow", null, "Allow", "global");
      const r2 = addRule(null, "test-cmd", "deny", null, "Deny", "global");
      updateRule(r2.id, { priority: 50 });

      const result = evaluate("proj-1", null, "bash", "test-cmd");
      expect(result.decision).toBe("deny");
    });

    it("tool_type filtering works - rule only matches specific tool type", () => {
      addRule(null, "SELECT", "deny", "sql", "No SQL selects", "global");

      // Should match sql tool type
      const sqlResult = evaluate("proj-1", null, "sql", "SELECT * FROM users");
      expect(sqlResult.decision).toBe("deny");

      // Should NOT match bash tool type (tool_type mismatch)
      const bashResult = evaluate("proj-1", null, "bash", "SELECT * FROM users");
      expect(bashResult.decision).toBe("allow");
    });
  });

  describe("testPattern", () => {
    it("returns true when pattern matches input", () => {
      expect(testPattern("rm -rf", null, "rm -rf /tmp")).toBe(true);
    });

    it("returns false when pattern does not match", () => {
      expect(testPattern("rm -rf", null, "echo hello")).toBe(false);
    });

    it("supports regex patterns", () => {
      expect(testPattern("\\bDROP\\b", null, "DROP TABLE users")).toBe(true);
      expect(testPattern("\\bDROP\\b", null, "backdrop")).toBe(false);
    });

    it("falls back to substring match for invalid regex", () => {
      // Invalid regex: unbalanced parenthesis
      expect(testPattern("test(", null, "this is a test(")).toBe(true);
    });
  });

  describe("getStats", () => {
    it("returns rule count and recent denials", () => {
      seedBuiltinRules();
      evaluate("proj-1", null, "bash", "rm -rf /");

      const stats = getStats("proj-1");
      expect(stats.ruleCount).toBeGreaterThanOrEqual(3);
      expect(stats.recentDenials).toBe(1);
    });

    it("returns stats without projectId (global)", () => {
      seedBuiltinRules();
      evaluate("proj-1", null, "bash", "rm -rf /");

      const stats = getStats();
      expect(stats.ruleCount).toBeGreaterThanOrEqual(3);
      expect(stats.recentDenials).toBe(1);
    });

    it("returns zeros when no rules exist", () => {
      const stats = getStats("proj-1");
      expect(stats).toEqual({ ruleCount: 0, recentDenials: 0 });
    });
  });

  describe("listAuditLog", () => {
    it("returns audit entries for a project", () => {
      evaluate("proj-1", null, "bash", "echo hello");
      evaluate("proj-1", null, "bash", "ls");
      evaluate("proj-2", null, "bash", "echo other");

      const log = listAuditLog("proj-1");
      expect(log).toHaveLength(2);
    });

    it("respects limit and offset", () => {
      for (let i = 0; i < 5; i++) {
        evaluate("proj-1", null, "bash", `cmd-${i}`);
      }

      const page = listAuditLog("proj-1", 2, 0);
      expect(page).toHaveLength(2);
    });

    it("returns empty for unknown project", () => {
      expect(listAuditLog("nonexistent")).toHaveLength(0);
    });
  });
});
