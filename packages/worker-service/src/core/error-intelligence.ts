import { createHash } from "node:crypto";
import { dbManager } from "./db-manager.js";
import { logger } from "./logger.js";
import { eventBus } from "./event-bus.js";
import { create as createObservation } from "./observations-service.js";

export interface AgentError {
  id: string;
  sessionId: string | null;
  projectId: string;
  errorType: string | null;
  message: string;
  stack: string | null;
  fingerprint: string;
  toolName: string | null;
  createdAt: string;
}

export interface ErrorPattern {
  fingerprint: string;
  projectId: string;
  messageTemplate: string;
  occurrenceCount: number;
  sessionCount: number;
  firstSeen: string;
  lastSeen: string;
  status: "active" | "resolved" | "ignored";
  resolveNote: string | null;
}

interface AgentErrorRow {
  id: string;
  session_id: string | null;
  project_id: string;
  error_type: string | null;
  message: string;
  stack: string | null;
  fingerprint: string;
  tool_name: string | null;
  created_at: string;
}

interface ErrorPatternRow {
  fingerprint: string;
  project_id: string;
  message_template: string;
  occurrence_count: number;
  session_count: number;
  first_seen: string;
  last_seen: string;
  status: string;
  resolve_note: string | null;
}

interface TrendRow {
  day: string;
  cnt: number;
}

function getDb() {
  return dbManager.getConnection();
}

function rowToError(row: AgentErrorRow): AgentError {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    errorType: row.error_type,
    message: row.message,
    stack: row.stack,
    fingerprint: row.fingerprint,
    toolName: row.tool_name,
    createdAt: row.created_at,
  };
}

function rowToPattern(row: ErrorPatternRow): ErrorPattern {
  return {
    fingerprint: row.fingerprint,
    projectId: row.project_id,
    messageTemplate: row.message_template,
    occurrenceCount: row.occurrence_count,
    sessionCount: row.session_count,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    status: row.status as "active" | "resolved" | "ignored",
    resolveNote: row.resolve_note,
  };
}

function normalizeMessage(message: string): string {
  return message
    .replace(/\/[^\s"']+/g, "<path>")           // strip file paths
    .replace(/\b\d+:\d+\b/g, "<loc>")            // strip line:col
    .replace(/0x[0-9a-fA-F]+/g, "<addr>")        // strip memory addresses
    .replace(/\b\d{4,}\b/g, "<num>")             // strip long numbers
    .replace(/\s+/g, " ")
    .trim();
}

function computeFingerprint(message: string): string {
  const normalized = normalizeMessage(message);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function upsertPattern(projectId: string, fingerprint: string, normalized: string, sessionId: string | null): void {
  const now = new Date().toISOString();
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM _error_patterns WHERE fingerprint = ?")
    .get(fingerprint) as ErrorPatternRow | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO _error_patterns
         (fingerprint, project_id, message_template, occurrence_count, session_count, first_seen, last_seen, status)
       VALUES (?, ?, ?, 1, 1, ?, ?, 'active')`,
    ).run(fingerprint, projectId, normalized, now, now);
  } else {
    const sessionCountIncrement = sessionId && sessionId !== existing.fingerprint ? 1 : 0;
    db.prepare(
      `UPDATE _error_patterns
       SET occurrence_count = occurrence_count + 1,
           session_count = session_count + ?,
           last_seen = ?,
           status = CASE WHEN status = 'resolved' THEN 'active' ELSE status END
       WHERE fingerprint = ?`,
    ).run(sessionCountIncrement, now, fingerprint);
  }

  // Check if we just hit the threshold for auto-creating an observation
  const updated = db
    .prepare("SELECT occurrence_count FROM _error_patterns WHERE fingerprint = ?")
    .get(fingerprint) as { occurrence_count: number } | undefined;

  if (updated && updated.occurrence_count === 3) {
    createObservation(
      projectId,
      `Recurring error detected: ${normalized.slice(0, 120)}`,
      "error-intelligence",
      "error",
      0.9,
    );
  }
}

export function record(
  projectId: string,
  sessionId: string | null,
  errorType: string,
  message: string,
  stack?: string,
  toolName?: string,
): AgentError | null {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const fingerprint = computeFingerprint(message);
  const normalized = normalizeMessage(message);

  try {
    getDb()
      .prepare(
        `INSERT INTO _agent_errors
           (id, session_id, project_id, error_type, message, stack, fingerprint, tool_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, sessionId, projectId, errorType, message, stack ?? null, fingerprint, toolName ?? null, now);

    upsertPattern(projectId, fingerprint, normalized, sessionId);

    if (sessionId) {
      getDb()
        .prepare("UPDATE _sessions SET error_count = error_count + 1 WHERE id = ?")
        .run(sessionId);
    }

    const row = getDb()
      .prepare("SELECT * FROM _agent_errors WHERE id = ?")
      .get(id) as AgentErrorRow | undefined;

    eventBus.publish("error:recorded", { projectId, errorId: id, fingerprint });
    return row ? rowToError(row) : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("error-intelligence", `Failed to record error: ${msg}`);
    return null;
  }
}

export function listErrors(projectId: string, limit = 50, offset = 0): AgentError[] {
  try {
    return (
      getDb()
        .prepare(
          "SELECT * FROM _agent_errors WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .all(projectId, limit, offset) as AgentErrorRow[]
    ).map(rowToError);
  } catch {
    return [];
  }
}

export function listPatterns(projectId: string): ErrorPattern[] {
  try {
    return (
      getDb()
        .prepare(
          "SELECT * FROM _error_patterns WHERE project_id = ? ORDER BY occurrence_count DESC",
        )
        .all(projectId) as ErrorPatternRow[]
    ).map(rowToPattern);
  } catch {
    return [];
  }
}

export function resolvePattern(fingerprint: string, note: string): boolean {
  try {
    const result = getDb()
      .prepare("UPDATE _error_patterns SET status = 'resolved', resolve_note = ? WHERE fingerprint = ?")
      .run(note, fingerprint);
    return result.changes > 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("error-intelligence", `Failed to resolve pattern: ${msg}`);
    return false;
  }
}

export function ignorePattern(fingerprint: string): boolean {
  try {
    const result = getDb()
      .prepare("UPDATE _error_patterns SET status = 'ignored' WHERE fingerprint = ?")
      .run(fingerprint);
    return result.changes > 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("error-intelligence", `Failed to ignore pattern: ${msg}`);
    return false;
  }
}

export function reactivateIfRecurring(fingerprint: string, projectId: string): boolean {
  try {
    const row = getDb()
      .prepare("SELECT occurrence_count FROM _error_patterns WHERE fingerprint = ? AND project_id = ?")
      .get(fingerprint, projectId) as { occurrence_count: number } | undefined;
    if (!row || row.occurrence_count < 3) return false;

    const result = getDb()
      .prepare("UPDATE _error_patterns SET status = 'active' WHERE fingerprint = ? AND status != 'active'")
      .run(fingerprint);
    return result.changes > 0;
  } catch {
    return false;
  }
}

export function getActiveWarnings(projectId: string): ErrorPattern[] {
  try {
    return (
      getDb()
        .prepare(
          "SELECT * FROM _error_patterns WHERE project_id = ? AND status = 'active' AND occurrence_count >= 3 ORDER BY occurrence_count DESC",
        )
        .all(projectId) as ErrorPatternRow[]
    ).map(rowToPattern);
  } catch {
    return [];
  }
}

export function trends(projectId: string): Array<{ day: string; count: number }> {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const rows = getDb()
      .prepare(
        `SELECT substr(created_at, 1, 10) as day, COUNT(*) as cnt
         FROM _agent_errors
         WHERE project_id = ? AND created_at > ?
         GROUP BY day ORDER BY day ASC`,
      )
      .all(projectId, cutoff) as TrendRow[];
    return rows.map((r) => ({ day: r.day, count: r.cnt }));
  } catch {
    return [];
  }
}

export function purgeOld(days = 30): number {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const result = getDb()
      .prepare("DELETE FROM _agent_errors WHERE created_at < ?")
      .run(cutoff);
    return result.changes;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("error-intelligence", `Failed to purge old errors: ${msg}`);
    return 0;
  }
}

export function getPatternStats(projectId: string): { count: number; active: number; recent: number } {
  try {
    const total = getDb()
      .prepare("SELECT COUNT(*) as cnt FROM _error_patterns WHERE project_id = ?")
      .get(projectId) as { cnt: number };
    const active = getDb()
      .prepare("SELECT COUNT(*) as cnt FROM _error_patterns WHERE project_id = ? AND status = 'active'")
      .get(projectId) as { cnt: number };
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recent = getDb()
      .prepare("SELECT COUNT(*) as cnt FROM _agent_errors WHERE project_id = ? AND created_at > ?")
      .get(projectId, since) as { cnt: number };
    return { count: total.cnt, active: active.cnt, recent: recent.cnt };
  } catch {
    return { count: 0, active: 0, recent: 0 };
  }
}
