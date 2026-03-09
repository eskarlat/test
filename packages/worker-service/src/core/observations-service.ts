import { dbManager } from "./db-manager.js";
import { logger } from "./logger.js";
import { eventBus } from "./event-bus.js";

export interface Observation {
  id: string;
  projectId: string;
  content: string;
  source: string;
  category: string;
  confidence: number;
  active: boolean;
  lastInjectedAt: string | null;
  injectionCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ObservationRow {
  id: string;
  project_id: string;
  content: string;
  source: string;
  category: string;
  confidence: number;
  active: number;
  last_injected_at: string | null;
  injection_count: number;
  created_at: string;
  updated_at: string;
}

interface ExtensionObsInput {
  content: string;
  source?: string;
  category?: string;
  confidence?: number;
}

function rowToObs(row: ObservationRow): Observation {
  return {
    id: row.id,
    projectId: row.project_id,
    content: row.content,
    source: row.source,
    category: row.category,
    confidence: row.confidence,
    active: row.active === 1,
    lastInjectedAt: row.last_injected_at,
    injectionCount: row.injection_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getDb() {
  return dbManager.getConnection();
}

const REMEMBER_PATTERN = /\b(?:remember|note|track|observe|keep in mind|always|never)\b/i;

function isSimilar(existingContent: string, newContent: string): boolean {
  const a = existingContent.toLowerCase().trim();
  const b = newContent.toLowerCase().trim();
  if (a === b) return true;
  // Simple substring overlap check for dedup
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return longer.includes(shorter) && shorter.length > 20;
}

export function create(
  projectId: string,
  content: string,
  source: string,
  category: string,
  confidence = 1.0,
): Observation | null {
  try {
    const existing = getDb()
      .prepare(
        "SELECT id, content FROM _observations WHERE project_id = ? AND active = 1",
      )
      .all(projectId) as Array<{ id: string; content: string }>;

    for (const obs of existing) {
      if (isSimilar(obs.content, content)) {
        logger.info("observations", `Duplicate observation skipped for project ${projectId}`);
        return null;
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO _observations
           (id, project_id, content, source, category, confidence, active,
            injection_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      )
      .run(id, projectId, content, source, category, confidence, now, now);

    const row = getDb()
      .prepare("SELECT * FROM _observations WHERE id = ?")
      .get(id) as ObservationRow;

    eventBus.publish("observation:created", { projectId, observationId: id });
    return rowToObs(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("observations", `Failed to create observation: ${msg}`);
    return null;
  }
}

export function list(projectId: string, activeOnly = true): Observation[] {
  try {
    const sql = activeOnly
      ? "SELECT * FROM _observations WHERE project_id = ? AND active = 1 ORDER BY created_at DESC"
      : "SELECT * FROM _observations WHERE project_id = ? ORDER BY created_at DESC";
    return (getDb().prepare(sql).all(projectId) as ObservationRow[]).map(rowToObs);
  } catch {
    return [];
  }
}

export function updateObservation(
  id: string,
  updates: Partial<Pick<Observation, "content" | "category" | "confidence" | "active">>,
): Observation | null {
  const now = new Date().toISOString();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.content !== undefined) { fields.push("content = ?"); values.push(updates.content); }
  if (updates.category !== undefined) { fields.push("category = ?"); values.push(updates.category); }
  if (updates.confidence !== undefined) { fields.push("confidence = ?"); values.push(updates.confidence); }
  if (updates.active !== undefined) { fields.push("active = ?"); values.push(updates.active ? 1 : 0); }

  if (fields.length === 0) return null;

  fields.push("updated_at = ?");
  values.push(now);
  values.push(id);

  try {
    const result = getDb()
      .prepare(`UPDATE _observations SET ${fields.join(", ")} WHERE id = ?`)
      .run(...values);
    if (result.changes > 0) {
      const row = getDb()
        .prepare("SELECT * FROM _observations WHERE id = ?")
        .get(id) as ObservationRow;
      const obs = rowToObs(row);
      eventBus.publish("observation:updated", { projectId: obs.projectId, observationId: id });
      return obs;
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("observations", `Failed to update observation: ${msg}`);
    return null;
  }
}

export function archiveObservation(id: string): Observation | null {
  return updateObservation(id, { active: false });
}

export function deleteObservation(id: string): Observation | null {
  try {
    const row = getDb()
      .prepare("SELECT * FROM _observations WHERE id = ?")
      .get(id) as ObservationRow | undefined;
    if (!row) return null;
    getDb().prepare("DELETE FROM _observations WHERE id = ?").run(id);
    const obs = rowToObs(row);
    eventBus.publish("observation:deleted", { projectId: obs.projectId, observationId: id });
    return obs;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("observations", `Failed to delete observation: ${msg}`);
    return null;
  }
}

export function confirmFromExtension(projectId: string, obs: ExtensionObsInput): Observation | null {
  return create(
    projectId,
    obs.content,
    obs.source ?? "extension",
    obs.category ?? "general",
    obs.confidence ?? 1.0,
  );
}

export function detectFromPrompt(projectId: string, prompt: string): void {
  if (!REMEMBER_PATTERN.test(prompt)) return;

  const sentences = prompt.split(/[.!?\n]+/);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length > 10 && REMEMBER_PATTERN.test(trimmed)) {
      create(projectId, trimmed, "auto-detect", "general", 0.7);
    }
  }
}

export function getForInjection(projectId: string, limit = 10): Observation[] {
  try {
    return (
      getDb()
        .prepare(
          `SELECT * FROM _observations
           WHERE project_id = ? AND active = 1
           ORDER BY confidence DESC, injection_count ASC, created_at DESC
           LIMIT ?`,
        )
        .all(projectId, limit) as ObservationRow[]
    ).map(rowToObs);
  } catch {
    return [];
  }
}

export function markInjected(ids: string[]): void {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  try {
    const placeholders = ids.map(() => "?").join(", ");
    getDb()
      .prepare(
        `UPDATE _observations
         SET last_injected_at = ?, injection_count = injection_count + 1, updated_at = ?
         WHERE id IN (${placeholders})`,
      )
      .run(now, now, ...ids);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("observations", `Failed to mark observations injected: ${msg}`);
  }
}

export function archiveStale(): number {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const result = getDb()
      .prepare(
        `UPDATE _observations SET active = 0, updated_at = ?
         WHERE active = 1 AND (last_injected_at < ? OR (last_injected_at IS NULL AND created_at < ?))`,
      )
      .run(new Date().toISOString(), cutoff, cutoff);
    return result.changes;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("observations", `Failed to archive stale observations: ${msg}`);
    return 0;
  }
}

export function getObservationStats(projectId: string): { count: number; byCategory: Record<string, number> } {
  try {
    const rows = getDb()
      .prepare(
        "SELECT category, COUNT(*) as cnt FROM _observations WHERE project_id = ? AND active = 1 GROUP BY category",
      )
      .all(projectId) as Array<{ category: string; cnt: number }>;

    const byCategory: Record<string, number> = {};
    let count = 0;
    for (const row of rows) {
      byCategory[row.category] = row.cnt;
      count += row.cnt;
    }
    return { count, byCategory };
  } catch {
    return { count: 0, byCategory: {} };
  }
}
