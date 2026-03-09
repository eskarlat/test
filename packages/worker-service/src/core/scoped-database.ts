import type Database from "better-sqlite3";
import type { ScopedStatement } from "@renre-kit/extension-sdk";

export class ScopedDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopedDatabaseError";
  }
}

const CORE_TABLES = new Set([
  "_migrations",
  "_vault",
  "_sessions",
  "_observations",
  "_tool_rules",
  "_tool_audit",
  "_prompts",
  "_agent_errors",
  "_error_patterns",
  "_tool_usage",
  "_subagent_events",
  "_hook_activity",
  "_context_providers",
  "_prompts_fts",
  "_observations_fts",
]);

const ALLOWED_DDL = /^\s*(CREATE\s+TABLE|CREATE\s+INDEX|ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN)/i;
const BLOCKED_DDL = /DROP\s+(TABLE|INDEX)|ALTER\s+TABLE\s+\S+\s+DROP/i;

export interface ScopedDatabase {
  readonly tablePrefix: string;
  readonly projectId: string;
  prepare(sql: string): ScopedStatement;
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
}

export function createScopedDatabase(
  db: Database.Database,
  extensionName: string,
  projectId: string,
): ScopedDatabase {
  const tablePrefix = `ext_${extensionName}_`;

  function validateSql(sql: string): void {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();

    // Block access to core tables
    for (const coreTable of CORE_TABLES) {
      if (normalized.includes(coreTable.toLowerCase())) {
        throw new ScopedDatabaseError(
          `Extension "${extensionName}" cannot access core table "${coreTable}"`,
        );
      }
    }

    // Check all referenced tables use correct prefix
    const tableRefs = extractTableRefs(normalized);
    for (const table of tableRefs) {
      if (!table.startsWith(tablePrefix.toLowerCase())) {
        throw new ScopedDatabaseError(
          `Extension "${extensionName}" can only access tables with prefix "${tablePrefix}", got "${table}"`,
        );
      }
    }

    // DDL validation
    const isDdl = /^\s*(create|alter|drop)/i.test(sql);
    if (isDdl) {
      if (BLOCKED_DDL.test(sql)) {
        throw new ScopedDatabaseError(
          `Extension "${extensionName}" cannot use DROP or ALTER...DROP DDL`,
        );
      }
      if (!ALLOWED_DDL.test(sql)) {
        throw new ScopedDatabaseError(
          `Extension "${extensionName}" DDL not allowed: only CREATE TABLE, CREATE INDEX, ALTER TABLE ADD COLUMN`,
        );
      }
    }
  }

  return {
    get tablePrefix() { return tablePrefix; },
    get projectId() { return projectId; },

    prepare(sql: string) {
      validateSql(sql);
      const stmt = db.prepare(sql);
      // Wrap the statement to auto-inject projectId for queries that don't already include it
      return wrapStatement(stmt, projectId, sql);
    },

    exec(sql: string) {
      // exec is only used for DDL in migrations
      validateSql(sql);
      db.exec(sql);
    },

    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
  };
}

/**
 * Wraps a better-sqlite3 Statement to auto-inject project_id for DML queries.
 * For SELECT/UPDATE/DELETE: if the SQL contains a `project_id` column reference
 * (e.g. WHERE project_id = ?), the projectId is prepended to the params.
 * For INSERT: if the SQL contains `project_id` in the column list, projectId is
 * injected at the matching position.
 *
 * Extensions can still pass project_id explicitly — this wrapper detects the
 * `project_id` placeholder in the SQL and fills it automatically only when
 * the query uses the `?` placeholder pattern for project_id.
 */
const PROJECT_ID_PARAM_RE = /\bproject_id\s*=\s*\?/i;
const INSERT_PROJECT_ID_RE = /\bproject_id\b/i;

function needsProjectIdInjection(sql: string): boolean {
  // Only inject for DML that references project_id with a ? placeholder
  if (/^\s*(select|update|delete)\b/i.test(sql)) {
    return PROJECT_ID_PARAM_RE.test(sql);
  }
  if (/^\s*insert\b/i.test(sql)) {
    return INSERT_PROJECT_ID_RE.test(sql);
  }
  return false;
}

function countPlaceholdersBefore(sql: string, targetColumn: string): number {
  // Find the position of `project_id` in the column list and count ? before it
  const targetIdx = sql.toLowerCase().indexOf(targetColumn.toLowerCase());
  if (targetIdx < 0) return 0;
  const before = sql.slice(0, targetIdx);
  return (before.match(/\?/g) ?? []).length;
}

function injectProjectId(params: unknown[], projectId: string, sql: string): unknown[] {
  if (/^\s*insert\b/i.test(sql)) {
    // For INSERT, find position of project_id in column list and inject at matching VALUES position
    const pos = countPlaceholdersBefore(sql, "project_id");
    const injected = [...params];
    injected.splice(pos, 0, projectId);
    return injected;
  }
  // For SELECT/UPDATE/DELETE with WHERE project_id = ?, prepend projectId
  return [projectId, ...params];
}

function wrapStatement(
  stmt: ReturnType<typeof import("better-sqlite3").prototype.prepare>,
  projectId: string,
  sql: string,
): ScopedStatement {
  const shouldInject = needsProjectIdInjection(sql);

  return {
    run(...params: unknown[]) {
      const args = shouldInject ? injectProjectId(params, projectId, sql) : params;
      return stmt.run(...args);
    },
    get(...params: unknown[]) {
      const args = shouldInject ? injectProjectId(params, projectId, sql) : params;
      return stmt.get(...args);
    },
    all(...params: unknown[]) {
      const args = shouldInject ? injectProjectId(params, projectId, sql) : params;
      return stmt.all(...args);
    },
  };
}

function extractTableRefs(sql: string): string[] {
  // Simple regex to extract table names from common SQL patterns
  // FROM table, JOIN table, INTO table, UPDATE table, TABLE table (DDL)
  const patterns = [
    /\bfrom\s+(\w+)/gi,
    /\bjoin\s+(\w+)/gi,
    /\binto\s+(\w+)/gi,
    /\bupdate\s+(\w+)/gi,
    /\btable\s+(?:if\s+not\s+exists\s+)?(\w+)/gi,
    /\bindex\s+\w+\s+on\s+(\w+)/gi,
  ];

  const tables = new Set<string>();
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    // Reset lastIndex for each pattern
    pattern.lastIndex = 0;
    while ((match = pattern.exec(sql)) !== null) {
      if (match[1]) tables.add(match[1].toLowerCase());
    }
  }
  return Array.from(tables);
}
