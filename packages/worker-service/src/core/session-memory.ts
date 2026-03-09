import { dbManager } from "./db-manager.js";
import { logger } from "./logger.js";
import { eventBus } from "./event-bus.js";

interface SessionRow {
  id: string;
  project_id: string;
  agent: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  prompt_count: number;
  tool_count: number;
  error_count: number;
  files_modified: string;
  decisions: string;
}

interface ErrorPatternRow {
  fingerprint: string;
  message_template: string;
  occurrence_count: number;
}

interface ObservationRow {
  id: string;
  content: string;
  category: string;
}

interface CheckpointRow {
  id: string;
  session_id: string;
  prompt_count: number;
  tool_count: number;
  error_count: number;
  files_modified: string;
  custom_instructions: string | null;
  created_at: string;
}

function getDb() {
  return dbManager.getConnection();
}

export function buildPromptSummary(sessionId: string): string | null {
  try {
    const db = getDb();

    // Intent + topic from first prompt
    const firstPrompt = db
      .prepare(
        `SELECT prompt_preview, intent_category FROM _prompts
         WHERE session_id = ? ORDER BY created_at ASC LIMIT 1`,
      )
      .get(sessionId) as { prompt_preview: string; intent_category: string } | undefined;
    if (!firstPrompt) return null;

    const topic = firstPrompt.prompt_preview.slice(0, 100);
    const intent = firstPrompt.intent_category !== "general" ? `[${firstPrompt.intent_category}] ` : "";

    // Session stats
    const session = db
      .prepare(
        `SELECT error_count, files_modified FROM _sessions WHERE id = ?`,
      )
      .get(sessionId) as { error_count: number; files_modified: string } | undefined;

    const parts: string[] = [];

    let files: string[] = [];
    try { files = JSON.parse(session?.files_modified ?? "[]") as string[]; } catch { /* ignore */ }
    if (files.length > 0) {
      const shown = files.slice(0, 3).map((f) => f.split("/").pop()).join(", ");
      parts.push(`edited ${shown}${files.length > 3 ? ` +${files.length - 3} more` : ""}`);
    }

    if (session && session.error_count > 0) {
      parts.push(`${session.error_count} error${session.error_count > 1 ? "s" : ""}`);
    }

    const detail = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
    return `${intent}${topic}${detail}`;
  } catch {
    return null;
  }
}

function buildRecentSessionsSummary(projectId: string): string {
  try {
    const rows = getDb()
      .prepare(
        `SELECT id, agent, started_at, ended_at, summary, prompt_count, tool_count, error_count
         FROM _sessions
         WHERE project_id = ? AND archived = 0 AND status = 'ended'
         ORDER BY started_at DESC
         LIMIT 3`,
      )
      .all(projectId) as SessionRow[];

    if (rows.length === 0) return "";

    const lines = rows.map((r) => {
      const date = r.started_at.slice(0, 10);
      const summary = r.summary ?? "(no summary)";
      return `- Session on ${date} [${r.agent}]: ${summary} (${r.prompt_count} prompts, ${r.tool_count} tools)`;
    });
    return `## Recent Sessions\n${lines.join("\n")}\n`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("session-memory", `Failed to build recent sessions summary: ${msg}`);
    return "";
  }
}

function buildActiveErrorWarnings(projectId: string): string {
  try {
    const rows = getDb()
      .prepare(
        `SELECT fingerprint, message_template, occurrence_count
         FROM _error_patterns
         WHERE project_id = ? AND status = 'active' AND occurrence_count >= 3
         ORDER BY occurrence_count DESC
         LIMIT 3`,
      )
      .all(projectId) as ErrorPatternRow[];

    if (rows.length === 0) return "";

    const lines = rows.map((r) => `- **${r.message_template}** (${r.occurrence_count} occurrences)`);
    return `## Known Error Patterns\n${lines.join("\n")}\n`;
  } catch {
    return "";
  }
}

function buildObservationsContext(projectId: string): string {
  try {
    const rows = getDb()
      .prepare(
        `SELECT id, content, category
         FROM _observations
         WHERE project_id = ? AND active = 1
         ORDER BY injection_count ASC, created_at DESC
         LIMIT 10`,
      )
      .all(projectId) as ObservationRow[];

    if (rows.length === 0) return "";

    const lines = rows.map((r) => `- [${r.category}] ${r.content}`);
    return `## Observations\n${lines.join("\n")}\n`;
  } catch {
    return "";
  }
}

export interface SessionStartResult {
  sessionId: string;
  additionalContext: string;
}

export function startSession(
  projectId: string,
  agent: string,
  source?: string,
): SessionStartResult {
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();

  // End any previous active session for this project+agent, auto-generating summary
  try {
    const prev = getDb()
      .prepare(
        `SELECT id FROM _sessions
         WHERE project_id = ? AND agent = ? AND status = 'active'`,
      )
      .all(projectId, agent) as Array<{ id: string }>;
    for (const row of prev) {
      const summary = buildPromptSummary(row.id);
      getDb()
        .prepare(
          `UPDATE _sessions SET status = 'ended', ended_at = ?, summary = COALESCE(summary, ?)
           WHERE id = ?`,
        )
        .run(now, summary, row.id);
    }
  } catch {
    // non-fatal
  }

  try {
    getDb()
      .prepare(
        `INSERT INTO _sessions
           (id, project_id, started_at, agent, status, source, context_injected,
            prompt_count, tool_count, error_count, files_modified, decisions, archived)
         VALUES (?, ?, ?, ?, 'active', ?, 1, 0, 0, 0, '[]', '[]', 0)`,
      )
      .run(sessionId, projectId, now, agent, source ?? null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("session-memory", `Failed to create session: ${msg}`);
  }

  eventBus.publish("session:started", { projectId, sessionId, agent });

  const parts: string[] = [];
  const recentSessions = buildRecentSessionsSummary(projectId);
  if (recentSessions) parts.push(recentSessions);
  const errorWarnings = buildActiveErrorWarnings(projectId);
  if (errorWarnings) parts.push(errorWarnings);
  const observations = buildObservationsContext(projectId);
  if (observations) parts.push(observations);

  const additionalContext = parts.join("\n");
  return { sessionId, additionalContext };
}


export function checkpoint(
  sessionId: string,
  projectId: string,
  customInstructions?: string,
): string {
  const checkpointId = crypto.randomUUID();
  const now = new Date().toISOString();
  let sessionRow: SessionRow | undefined;

  try {
    sessionRow = getDb()
      .prepare(
        `SELECT id, project_id, agent, started_at, ended_at, summary,
                prompt_count, tool_count, error_count, files_modified, decisions
         FROM _sessions WHERE id = ?`,
      )
      .get(sessionId) as SessionRow | undefined;
  } catch {
    // proceed with empty data
  }

  const promptCount = sessionRow?.prompt_count ?? 0;
  const toolCount = sessionRow?.tool_count ?? 0;
  const errorCount = sessionRow?.error_count ?? 0;
  const filesModified = sessionRow?.files_modified ?? "[]";

  try {
    getDb()
      .prepare(
        `INSERT INTO _session_checkpoints
           (id, session_id, project_id, trigger, summary, prompt_count, tool_count,
            error_count, files_modified, custom_instructions, created_at)
         VALUES (?, ?, ?, 'preCompact', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        checkpointId,
        sessionId,
        projectId,
        sessionRow?.summary ?? null,
        promptCount,
        toolCount,
        errorCount,
        filesModified,
        customInstructions ?? null,
        now,
      );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("session-memory", `Failed to save checkpoint: ${msg}`);
  }

  let filesArr: string[] = [];
  try {
    filesArr = JSON.parse(filesModified) as string[];
  } catch {
    filesArr = [];
  }

  const parts: string[] = [
    "## Session Compaction Summary",
    `- ${promptCount} prompts processed`,
    `- ${toolCount} tool uses recorded`,
    `- ${errorCount} errors encountered`,
  ];

  if (filesArr.length > 0) {
    parts.push(`- Files modified: ${filesArr.slice(0, 10).join(", ")}`);
  }

  const observations = buildObservationsContext(projectId);
  if (observations) parts.push("", observations);

  const errorWarnings = buildActiveErrorWarnings(projectId);
  if (errorWarnings) parts.push("", errorWarnings);

  if (customInstructions) {
    parts.push("", `## Custom Instructions\n${customInstructions}`);
  }

  return parts.join("\n");
}

export function archiveOldSessions(): number {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const result = getDb()
      .prepare(
        `UPDATE _sessions SET archived = 1
         WHERE archived = 0 AND status = 'ended' AND ended_at < ?`,
      )
      .run(cutoff);
    return result.changes;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("session-memory", `Failed to archive old sessions: ${msg}`);
    return 0;
  }
}

export function buildSessionContext(projectId: string): string {
  const parts: string[] = [];
  const recentSessions = buildRecentSessionsSummary(projectId);
  if (recentSessions) parts.push(recentSessions);
  return parts.join("\n");
}

const OUTPUT_SNAPSHOT_MAX = 500;

export function recordHookActivity(
  sessionId: string | null,
  projectId: string,
  event: string,
  feature: string,
  durationMs: number,
  success: boolean,
  error?: string,
  output?: unknown,
): void {
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    let outputSnapshot: string | null = null;
    if (output !== undefined && output !== null && typeof output === "object" && Object.keys(output as object).length > 0) {
      const serialized = JSON.stringify(output);
      outputSnapshot = serialized.length > OUTPUT_SNAPSHOT_MAX
        ? serialized.slice(0, OUTPUT_SNAPSHOT_MAX) + "…"
        : serialized;
    }
    getDb()
      .prepare(
        `INSERT INTO _hook_activity
           (id, session_id, project_id, event, feature, duration_ms, success, error, output_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        sessionId,
        projectId,
        event,
        feature,
        durationMs,
        success ? 1 : 0,
        error ?? null,
        outputSnapshot,
        now,
      );
  } catch {
    // non-fatal
  }
}

export function getSessionCheckpoints(sessionId: string): CheckpointRow[] {
  try {
    return getDb()
      .prepare(
        `SELECT id, session_id, prompt_count, tool_count, error_count,
                files_modified, custom_instructions, created_at
         FROM _session_checkpoints WHERE session_id = ? ORDER BY created_at ASC`,
      )
      .all(sessionId) as CheckpointRow[];
  } catch {
    return [];
  }
}
