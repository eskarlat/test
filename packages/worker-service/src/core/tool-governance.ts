import { dbManager } from "./db-manager.js";
import { logger } from "./logger.js";
import { eventBus } from "./event-bus.js";

export type GovernanceDecision = "allow" | "deny" | "ask";
export type RuleScope = "global" | "project";

export interface ToolRule {
  id: string;
  pattern: string;
  decision: GovernanceDecision;
  toolType: string | null;
  reason: string | null;
  priority: number;
  scope: RuleScope;
  projectId: string | null;
  enabled: boolean;
  hitCount: number;
  createdAt: string;
}

interface ToolRuleRow {
  id: string;
  pattern: string;
  decision: string;
  tool_type: string | null;
  reason: string | null;
  priority: number;
  scope: string;
  project_id: string | null;
  enabled: number;
  hit_count: number;
  created_at: string;
}

export interface GovernanceResult {
  decision: GovernanceDecision;
  reason?: string;
  ruleId?: string;
}

const BUILTIN_RULES: Array<{
  id: string;
  pattern: string;
  decision: "deny";
  toolType: string | null;
  reason: string;
  priority: number;
}> = [
  {
    id: "builtin-rm-rf",
    pattern: "rm -rf",
    decision: "deny",
    toolType: "bash",
    reason: "Destructive recursive delete is not allowed",
    priority: 100,
  },
  {
    id: "builtin-drop-table",
    pattern: "DROP TABLE",
    decision: "deny",
    toolType: "sql",
    reason: "Dropping tables requires explicit approval",
    priority: 100,
  },
  {
    id: "builtin-force-push-main",
    pattern: "git push.*--force.*main|git push.*main.*--force",
    decision: "deny",
    toolType: "bash",
    reason: "Force pushing to main branch is not allowed",
    priority: 100,
  },
];

function getDb() {
  return dbManager.getConnection();
}

function rowToRule(row: ToolRuleRow): ToolRule {
  return {
    id: row.id,
    pattern: row.pattern,
    decision: row.decision as GovernanceDecision,
    toolType: row.tool_type,
    reason: row.reason,
    priority: row.priority,
    scope: row.scope as RuleScope,
    projectId: row.project_id,
    enabled: row.enabled === 1,
    hitCount: row.hit_count,
    createdAt: row.created_at,
  };
}

export function seedBuiltinRules(): void {
  const db = getDb();
  const now = new Date().toISOString();
  for (const rule of BUILTIN_RULES) {
    try {
      const existing = db
        .prepare("SELECT id FROM _tool_rules WHERE id = ?")
        .get(rule.id);
      if (!existing) {
        db.prepare(
          `INSERT INTO _tool_rules
             (id, pattern, decision, tool_type, reason, priority, scope, project_id, enabled, hit_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'global', NULL, 1, 0, ?)`,
        ).run(rule.id, rule.pattern, rule.decision, rule.toolType, rule.reason, rule.priority, now);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("tool-governance", `Failed to seed builtin rule ${rule.id}: ${msg}`);
    }
  }
}

function matchesPattern(pattern: string, toolType: string | null, toolName: string, toolInput: string): boolean {
  if (toolType !== null && toolType !== toolName) return false;
  try {
    return new RegExp(pattern, "i").test(toolInput);
  } catch {
    return toolInput.toLowerCase().includes(pattern.toLowerCase());
  }
}

function recordAudit(
  projectId: string,
  sessionId: string | null,
  toolType: string,
  toolInput: string,
  decision: string,
  ruleId: string | null,
  reason: string | null,
): void {
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO _tool_audit
           (id, session_id, project_id, tool_type, tool_input, decision, rule_id, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, sessionId, projectId, toolType, toolInput, decision, ruleId, reason, now);
  } catch {
    // non-fatal
  }
}

export function evaluate(
  projectId: string,
  sessionId: string | null,
  toolName: string,
  toolInput: string,
): GovernanceResult {
  let rules: ToolRuleRow[] = [];
  try {
    rules = getDb()
      .prepare(
        `SELECT * FROM _tool_rules
         WHERE enabled = 1
           AND (scope = 'global' OR (scope = 'project' AND project_id = ?))
         ORDER BY priority DESC, created_at ASC`,
      )
      .all(projectId) as ToolRuleRow[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("tool-governance", `Failed to load rules: ${msg}`);
  }

  for (const row of rules) {
    if (matchesPattern(row.pattern, row.tool_type, toolName, toolInput)) {
      try {
        getDb()
          .prepare("UPDATE _tool_rules SET hit_count = hit_count + 1 WHERE id = ?")
          .run(row.id);
      } catch {
        // non-fatal
      }

      const decision = row.decision as GovernanceDecision;
      recordAudit(projectId, sessionId, toolName, toolInput, decision, row.id, row.reason);

      if (decision === "deny") {
        eventBus.publish("tool:denied", { projectId, toolName, ruleId: row.id, reason: row.reason });
      }

      return { decision, reason: row.reason ?? undefined, ruleId: row.id };
    }
  }

  recordAudit(projectId, sessionId, toolName, toolInput, "allow", null, null);
  return { decision: "allow" };
}

export function addRule(
  projectId: string | null,
  pattern: string,
  decision: GovernanceDecision,
  toolType: string | null,
  reason: string | null,
  scope: RuleScope,
): ToolRule {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO _tool_rules
         (id, pattern, decision, tool_type, reason, priority, scope, project_id, enabled, hit_count, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, 0, ?)`,
    )
    .run(id, pattern, decision, toolType, reason, scope, projectId, now);

  const row = getDb()
    .prepare("SELECT * FROM _tool_rules WHERE id = ?")
    .get(id) as ToolRuleRow;
  return rowToRule(row);
}

export function updateRule(
  id: string,
  updates: Partial<Pick<ToolRule, "pattern" | "decision" | "toolType" | "reason" | "priority" | "enabled">>,
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.pattern !== undefined) { fields.push("pattern = ?"); values.push(updates.pattern); }
  if (updates.decision !== undefined) { fields.push("decision = ?"); values.push(updates.decision); }
  if (updates.toolType !== undefined) { fields.push("tool_type = ?"); values.push(updates.toolType); }
  if (updates.reason !== undefined) { fields.push("reason = ?"); values.push(updates.reason); }
  if (updates.priority !== undefined) { fields.push("priority = ?"); values.push(updates.priority); }
  if (updates.enabled !== undefined) { fields.push("enabled = ?"); values.push(updates.enabled ? 1 : 0); }

  if (fields.length === 0) return false;
  values.push(id);

  try {
    const result = getDb()
      .prepare(`UPDATE _tool_rules SET ${fields.join(", ")} WHERE id = ?`)
      .run(...values);
    return result.changes > 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("tool-governance", `Failed to update rule: ${msg}`);
    return false;
  }
}

export function deleteRule(id: string): boolean {
  try {
    const result = getDb()
      .prepare("DELETE FROM _tool_rules WHERE id = ?")
      .run(id);
    return result.changes > 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("tool-governance", `Failed to delete rule: ${msg}`);
    return false;
  }
}

export function listRules(scope?: RuleScope, projectId?: string): ToolRule[] {
  try {
    let sql = "SELECT * FROM _tool_rules WHERE 1=1";
    const params: unknown[] = [];
    if (scope === "global") {
      sql += " AND scope = 'global'";
    } else if (projectId) {
      sql += " AND (scope = 'global' OR (scope = 'project' AND project_id = ?))";
      params.push(projectId);
    }
    sql += " ORDER BY priority DESC, created_at ASC";
    return (getDb().prepare(sql).all(...params) as ToolRuleRow[]).map(rowToRule);
  } catch {
    return [];
  }
}

export function toggleRule(id: string): boolean {
  try {
    const result = getDb()
      .prepare("UPDATE _tool_rules SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?")
      .run(id);
    return result.changes > 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("tool-governance", `Failed to toggle rule: ${msg}`);
    return false;
  }
}

export function testPattern(
  pattern: string,
  toolType: string | null,
  toolInput: string,
): boolean {
  return matchesPattern(pattern, toolType, toolType ?? "unknown", toolInput);
}

export function getStats(projectId?: string): { ruleCount: number; recentDenials: number } {
  try {
    const countRow = projectId
      ? (getDb()
          .prepare(
            "SELECT COUNT(*) as cnt FROM _tool_rules WHERE enabled = 1 AND (scope = 'global' OR (scope = 'project' AND project_id = ?))",
          )
          .get(projectId) as { cnt: number })
      : (getDb()
          .prepare("SELECT COUNT(*) as cnt FROM _tool_rules WHERE enabled = 1")
          .get() as { cnt: number });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const denialRow = projectId
      ? (getDb()
          .prepare(
            "SELECT COUNT(*) as cnt FROM _tool_audit WHERE project_id = ? AND decision = 'deny' AND created_at > ?",
          )
          .get(projectId, since) as { cnt: number })
      : (getDb()
          .prepare("SELECT COUNT(*) as cnt FROM _tool_audit WHERE decision = 'deny' AND created_at > ?")
          .get(since) as { cnt: number });

    return { ruleCount: countRow.cnt, recentDenials: denialRow.cnt };
  } catch {
    return { ruleCount: 0, recentDenials: 0 };
  }
}

export function listAuditLog(projectId: string, limit = 50, offset = 0): unknown[] {
  try {
    return getDb()
      .prepare(
        `SELECT * FROM _tool_audit WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(projectId, limit, offset);
  } catch {
    return [];
  }
}
