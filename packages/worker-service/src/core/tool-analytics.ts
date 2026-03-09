import { dbManager } from "./db-manager.js";
import { logger } from "./logger.js";
import { eventBus } from "./event-bus.js";
import { create as createObservation } from "./observations-service.js";

export interface ToolUsage {
  id: string;
  sessionId: string | null;
  projectId: string;
  toolName: string;
  toolInput: string | null;
  resultSummary: string | null;
  filePath: string | null;
  durationMs: number | null;
  success: boolean;
  createdAt: string;
}

interface ToolUsageRow {
  id: string;
  session_id: string | null;
  project_id: string;
  tool_name: string;
  tool_input: string | null;
  result_summary: string | null;
  file_path: string | null;
  duration_ms: number | null;
  success: number;
  created_at: string;
}

function getDb() {
  return dbManager.getConnection();
}

function rowToUsage(row: ToolUsageRow): ToolUsage {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    toolName: row.tool_name,
    toolInput: row.tool_input,
    resultSummary: row.result_summary,
    filePath: row.file_path,
    durationMs: row.duration_ms,
    success: row.success === 1,
    createdAt: row.created_at,
  };
}

function extractFilePath(toolInputJson: string): string | null {
  try {
    const obj = JSON.parse(toolInputJson) as Record<string, unknown>;
    const pathVal = obj["path"] ?? obj["file_path"] ?? obj["filePath"];
    if (typeof pathVal === "string") return pathVal;
  } catch {
    // ignore
  }
  return null;
}

function truncateResult(resultJson: string): string {
  if (resultJson.length > 200) return resultJson.slice(0, 200) + "...";
  return resultJson;
}

function aggregateByTool(
  rows: Array<{ tool_name: string; cnt: number }>,
): { byTool: Record<string, number>; totalCount: number } {
  const byTool: Record<string, number> = {};
  let totalCount = 0;
  for (const r of rows) {
    byTool[r.tool_name] = r.cnt;
    totalCount += r.cnt;
  }
  return { byTool, totalCount };
}

export function record(
  projectId: string,
  sessionId: string | null,
  toolName: string,
  toolInput: string,
  toolOutput: string,
  durationMs?: number,
  success = true,
): ToolUsage | null {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const filePath = extractFilePath(toolInput);
  const resultSummary = truncateResult(toolOutput);

  try {
    getDb()
      .prepare(
        `INSERT INTO _tool_usage
           (id, session_id, project_id, tool_name, tool_input, result_summary, file_path, duration_ms, success, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        sessionId,
        projectId,
        toolName,
        toolInput,
        resultSummary,
        filePath,
        durationMs ?? null,
        success ? 1 : 0,
        now,
      );

    if (sessionId) {
      getDb()
        .prepare("UPDATE _sessions SET tool_count = tool_count + 1 WHERE id = ?")
        .run(sessionId);

      if (filePath) {
        updateSessionFilesModified(sessionId, filePath);
      }

      detectPatterns(projectId, sessionId);
    }

    const row = getDb()
      .prepare("SELECT * FROM _tool_usage WHERE id = ?")
      .get(id) as ToolUsageRow | undefined;

    eventBus.publish("tool:used", { projectId, toolName, toolId: id });
    return row ? rowToUsage(row) : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("tool-analytics", `Failed to record tool usage: ${msg}`);
    return null;
  }
}

function updateSessionFilesModified(sessionId: string, filePath: string): void {
  try {
    const row = getDb()
      .prepare("SELECT files_modified FROM _sessions WHERE id = ?")
      .get(sessionId) as { files_modified: string } | undefined;
    if (!row) return;

    let files: string[] = [];
    try { files = JSON.parse(row.files_modified) as string[]; } catch { files = []; }

    if (!files.includes(filePath)) {
      files.push(filePath);
      getDb()
        .prepare("UPDATE _sessions SET files_modified = ? WHERE id = ?")
        .run(JSON.stringify(files), sessionId);
    }
  } catch {
    // non-fatal
  }
}

export function detectPatterns(projectId: string, sessionId: string): void {
  try {
    detectFileThrashing(projectId, sessionId);
    detectCommandLoops(projectId, sessionId);
  } catch {
    // non-fatal
  }
}

function detectFileThrashing(projectId: string, sessionId: string): void {
  const rows = getDb()
    .prepare(
      `SELECT file_path, COUNT(*) as cnt
       FROM _tool_usage
       WHERE session_id = ? AND file_path IS NOT NULL
       GROUP BY file_path HAVING cnt >= 5`,
    )
    .all(sessionId) as Array<{ file_path: string; cnt: number }>;

  for (const row of rows) {
    createObservation(
      projectId,
      `File thrashing detected: "${row.file_path}" was modified ${row.cnt} times in one session`,
      "tool-analytics",
      "pattern",
      0.8,
    );
  }
}

function detectCommandLoops(projectId: string, sessionId: string): void {
  const rows = getDb()
    .prepare(
      `SELECT tool_name, tool_input, COUNT(*) as cnt
       FROM _tool_usage
       WHERE session_id = ? AND success = 0
       GROUP BY tool_name, tool_input HAVING cnt >= 3`,
    )
    .all(sessionId) as Array<{ tool_name: string; tool_input: string | null; cnt: number }>;

  for (const row of rows) {
    createObservation(
      projectId,
      `Command loop detected: "${row.tool_name}" failed ${row.cnt} times with same input`,
      "tool-analytics",
      "pattern",
      0.85,
    );
  }
}

export function getSessionAnalytics(projectId: string, sessionId: string): {
  byTool: Record<string, number>;
  successRate: number;
  fileHotspots: Array<{ filePath: string; count: number }>;
  totalCount: number;
} {
  try {
    const byToolRows = getDb()
      .prepare(
        "SELECT tool_name, COUNT(*) as cnt FROM _tool_usage WHERE session_id = ? GROUP BY tool_name",
      )
      .all(sessionId) as Array<{ tool_name: string; cnt: number }>;

    const { byTool, totalCount } = aggregateByTool(byToolRows);

    const successRow = getDb()
      .prepare(
        "SELECT COUNT(*) as total, SUM(success) as succeeded FROM _tool_usage WHERE session_id = ?",
      )
      .get(sessionId) as { total: number; succeeded: number };

    const successRate = successRow.total > 0 ? successRow.succeeded / successRow.total : 1;

    const hotspotRows = getDb()
      .prepare(
        `SELECT file_path, COUNT(*) as cnt FROM _tool_usage
         WHERE session_id = ? AND file_path IS NOT NULL
         GROUP BY file_path ORDER BY cnt DESC LIMIT 5`,
      )
      .all(sessionId) as Array<{ file_path: string; cnt: number }>;

    const fileHotspots = hotspotRows.map((r) => ({ filePath: r.file_path, count: r.cnt }));

    return { byTool, successRate, fileHotspots, totalCount };
  } catch {
    return { byTool: {}, successRate: 1, fileHotspots: [], totalCount: 0 };
  }
}

export function getAnalytics(projectId: string): {
  totalCount: number;
  mostTouchedFiles: Array<{ filePath: string; count: number }>;
  byTool: Record<string, number>;
  successRate: number;
} {
  try {
    const byToolRows = getDb()
      .prepare(
        "SELECT tool_name, COUNT(*) as cnt FROM _tool_usage WHERE project_id = ? GROUP BY tool_name ORDER BY cnt DESC",
      )
      .all(projectId) as Array<{ tool_name: string; cnt: number }>;

    const { byTool, totalCount } = aggregateByTool(byToolRows);

    const successRow = getDb()
      .prepare(
        "SELECT COUNT(*) as total, SUM(success) as succeeded FROM _tool_usage WHERE project_id = ?",
      )
      .get(projectId) as { total: number; succeeded: number };

    const successRate = successRow.total > 0 ? successRow.succeeded / successRow.total : 1;

    const fileRows = getDb()
      .prepare(
        `SELECT file_path, COUNT(*) as cnt FROM _tool_usage
         WHERE project_id = ? AND file_path IS NOT NULL
         GROUP BY file_path ORDER BY cnt DESC LIMIT 10`,
      )
      .all(projectId) as Array<{ file_path: string; cnt: number }>;

    const mostTouchedFiles = fileRows.map((r) => ({ filePath: r.file_path, count: r.cnt }));

    return { totalCount, mostTouchedFiles, byTool, successRate };
  } catch {
    return { totalCount: 0, mostTouchedFiles: [], byTool: {}, successRate: 1 };
  }
}

export function listUsage(projectId: string, limit = 50, offset = 0): ToolUsage[] {
  try {
    return (
      getDb()
        .prepare(
          "SELECT * FROM _tool_usage WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .all(projectId, limit, offset) as ToolUsageRow[]
    ).map(rowToUsage);
  } catch {
    return [];
  }
}

export function purgeOld(days = 30): number {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const result = getDb()
      .prepare("DELETE FROM _tool_usage WHERE created_at < ?")
      .run(cutoff);
    return result.changes;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("tool-analytics", `Failed to purge old tool usage: ${msg}`);
    return 0;
  }
}

export function listWarnings(
  projectId: string,
  limit = 50,
): Array<{ type: string; sessionId: string; detail: string; createdAt: string }> {
  try {
    const rows = getDb()
      .prepare(
        `SELECT tool_name, session_id, result_summary, created_at
         FROM _tool_usage
         WHERE project_id = ? AND success = 0
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(projectId, limit) as Array<{
        tool_name: string;
        session_id: string | null;
        result_summary: string | null;
        created_at: string;
      }>;

    return rows.map((r) => ({
      type: r.tool_name,
      sessionId: r.session_id ?? "unknown",
      detail: r.result_summary ?? "Tool failed",
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export function getStats(projectId: string): { total: number; warnings: number } {
  try {
    const totalRow = getDb()
      .prepare("SELECT COUNT(*) as cnt FROM _tool_usage WHERE project_id = ?")
      .get(projectId) as { cnt: number };

    const warningRow = getDb()
      .prepare("SELECT COUNT(*) as cnt FROM _tool_usage WHERE project_id = ? AND success = 0")
      .get(projectId) as { cnt: number };

    return { total: totalRow.cnt, warnings: warningRow.cnt };
  } catch {
    return { total: 0, warnings: 0 };
  }
}
