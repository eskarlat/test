import { dbManager } from "./db-manager.js";

export type SearchTable = "prompts" | "observations" | "errors" | "sessions";

export interface SearchResult {
  table: SearchTable;
  id: string;
  projectId: string;
  preview: string;
  createdAt?: string;
}

interface FtsRow {
  id: string;
  project_id: string;
  snippet?: string;
  created_at?: string;
}

function getDb() {
  return dbManager.getConnection();
}

function mapRows(table: SearchTable, rows: FtsRow[]): SearchResult[] {
  return rows.map((r) => ({
    table,
    id: r.id,
    projectId: r.project_id,
    preview: r.snippet ?? "",
    createdAt: r.created_at,
  }));
}

function sanitizeFtsQuery(q: string): string {
  return q.replace(/["*()]/g, " ").trim();
}

export function searchPrompts(
  projectId: string,
  q: string,
  limit = 20,
): SearchResult[] {
  const sanitized = sanitizeFtsQuery(q);
  if (!sanitized) return [];

  try {
    const rows = getDb()
      .prepare(
        `SELECT p.id, p.project_id, p.prompt_preview as snippet, p.created_at
         FROM _prompts p
         JOIN _prompts_fts fts ON fts.rowid = p.rowid
         WHERE fts._prompts_fts MATCH ? AND p.project_id = ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(sanitized, projectId, limit) as FtsRow[];
    return mapRows("prompts", rows);
  } catch {
    return searchPromptsLike(projectId, sanitized, limit);
  }
}

function searchPromptsLike(projectId: string, q: string, limit: number): SearchResult[] {
  try {
    const rows = getDb()
      .prepare(
        "SELECT id, project_id, prompt_preview as snippet, created_at FROM _prompts WHERE project_id = ? AND prompt_preview LIKE ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(projectId, `%${q}%`, limit) as FtsRow[];
    return mapRows("prompts", rows);
  } catch {
    return [];
  }
}

export function searchObservations(
  projectId: string,
  q: string,
  limit = 20,
): SearchResult[] {
  const sanitized = sanitizeFtsQuery(q);
  if (!sanitized) return [];

  try {
    const rows = getDb()
      .prepare(
        `SELECT o.id, o.project_id, o.content as snippet, o.created_at
         FROM _observations o
         JOIN _observations_fts fts ON fts.rowid = o.rowid
         WHERE fts._observations_fts MATCH ? AND o.project_id = ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(sanitized, projectId, limit) as FtsRow[];
    return mapRows("observations", rows);
  } catch {
    return searchObservationsLike(projectId, sanitized, limit);
  }
}

function searchObservationsLike(projectId: string, q: string, limit: number): SearchResult[] {
  try {
    const rows = getDb()
      .prepare(
        "SELECT id, project_id, content as snippet, created_at FROM _observations WHERE project_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(projectId, `%${q}%`, limit) as FtsRow[];
    return mapRows("observations", rows);
  } catch {
    return [];
  }
}

export function searchErrors(
  projectId: string,
  q: string,
  limit = 20,
): SearchResult[] {
  const sanitized = sanitizeFtsQuery(q);
  if (!sanitized) return [];

  try {
    const rows = getDb()
      .prepare(
        `SELECT e.id, e.project_id, e.message as snippet, e.created_at
         FROM _agent_errors e
         JOIN _agent_errors_fts fts ON fts.rowid = e.rowid
         WHERE fts._agent_errors_fts MATCH ? AND e.project_id = ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(sanitized, projectId, limit) as FtsRow[];
    return mapRows("errors", rows);
  } catch {
    return searchErrorsLike(projectId, sanitized, limit);
  }
}

function searchErrorsLike(projectId: string, q: string, limit: number): SearchResult[] {
  try {
    const rows = getDb()
      .prepare(
        "SELECT id, project_id, message as snippet, created_at FROM _agent_errors WHERE project_id = ? AND message LIKE ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(projectId, `%${q}%`, limit) as FtsRow[];
    return mapRows("errors", rows);
  } catch {
    return [];
  }
}

export function searchSessions(
  projectId: string,
  q: string,
  limit = 20,
): SearchResult[] {
  const sanitized = sanitizeFtsQuery(q);
  if (!sanitized) return [];

  try {
    const rows = getDb()
      .prepare(
        `SELECT s.id, s.project_id, s.summary as snippet, s.started_at as created_at
         FROM _sessions s
         JOIN _sessions_fts fts ON fts.rowid = s.rowid
         WHERE fts._sessions_fts MATCH ? AND s.project_id = ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(sanitized, projectId, limit) as FtsRow[];
    return mapRows("sessions", rows);
  } catch {
    return searchSessionsLike(projectId, sanitized, limit);
  }
}

function searchSessionsLike(projectId: string, q: string, limit: number): SearchResult[] {
  try {
    const rows = getDb()
      .prepare(
        "SELECT id, project_id, summary as snippet, started_at as created_at FROM _sessions WHERE project_id = ? AND (summary LIKE ? OR agent LIKE ?) ORDER BY started_at DESC LIMIT ?",
      )
      .all(projectId, `%${q}%`, `%${q}%`, limit) as FtsRow[];
    return mapRows("sessions", rows);
  } catch {
    return [];
  }
}

export function searchAll(
  projectId: string,
  q: string,
  limit = 20,
): SearchResult[] {
  const perTableLimit = Math.ceil(limit / 4);
  const results: SearchResult[] = [
    ...searchPrompts(projectId, q, perTableLimit),
    ...searchObservations(projectId, q, perTableLimit),
    ...searchErrors(projectId, q, perTableLimit),
    ...searchSessions(projectId, q, perTableLimit),
  ];
  return results.slice(0, limit);
}
