import { dbManager } from "./db-manager.js";
import { logger } from "./logger.js";

export interface Session {
  id: string;
  projectId: string;
  startedAt: string;
  agent: string;
  status: "active" | "ended";
  endedAt?: string;
  summary?: string;
}

function getDb() {
  return dbManager.getConnection();
}

export function createSession(projectId: string, agent: string): Session {
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  try {
    getDb()
      .prepare(
        "INSERT INTO _sessions (id, project_id, started_at, agent, status) VALUES (?, ?, ?, ?, 'active')",
      )
      .run(id, projectId, startedAt, agent);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("sessions", `Failed to create session: ${msg}`);
  }
  return { id, projectId, startedAt, agent, status: "active" };
}

export function endSession(sessionId: string, summary?: string): void {
  const endedAt = new Date().toISOString();
  try {
    getDb()
      .prepare(
        "UPDATE _sessions SET status = 'ended', ended_at = ?, summary = ? WHERE id = ?",
      )
      .run(endedAt, summary ?? null, sessionId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("sessions", `Failed to end session: ${msg}`);
  }
}

export function listActiveSessions(projectId: string): Session[] {
  try {
    return getDb()
      .prepare(
        "SELECT id, project_id as projectId, started_at as startedAt, agent, status, ended_at as endedAt, summary FROM _sessions WHERE project_id = ? AND status = 'active' ORDER BY started_at DESC",
      )
      .all(projectId) as Session[];
  } catch {
    return [];
  }
}
