import { Router, type Request, type Response } from "express";
import { getUsage } from "../core/context-monitor.js";
import { dbManager } from "../core/db-manager.js";
import { assemble } from "../core/context-recipe-engine.js";
import { getSessionCheckpoints } from "../core/session-memory.js";

const router = Router();

interface SessionRow {
  id: string;
  project_id: string;
  agent: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  prompt_count: number;
  tool_count: number;
  error_count: number;
  files_modified: string;
  archived: number;
  source: string | null;
}

interface TimelineItem {
  type: string;
  id: string;
  createdAt: string;
  data: Record<string, unknown>;
}

function getDb() {
  return dbManager.getConnection();
}

// List sessions (paginated, filterable)
router.get("/api/:projectId/sessions", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const limit = typeof req.query["limit"] === "string" ? parseInt(req.query["limit"], 10) : 20;
  const offset = typeof req.query["offset"] === "string" ? parseInt(req.query["offset"], 10) : 0;
  const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
  const archived = req.query["archived"] === "true" ? 1 : 0;

  try {
    let sql = "SELECT * FROM _sessions WHERE project_id = ? AND archived = ?";
    const params: unknown[] = [projectId, archived];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    sql += " ORDER BY started_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = getDb().prepare(sql).all(...params) as SessionRow[];
    res.json(rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      agent: r.agent,
      status: r.status,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      summary: r.summary,
      promptCount: r.prompt_count,
      toolCount: r.tool_count,
      errorCount: r.error_count,
    })));
  } catch {
    res.json([]);
  }
});

// Session stats
router.get("/api/:projectId/sessions/stats", (req: Request, res: Response) => {
  const { projectId } = req.params;
  try {
    const total = getDb()
      .prepare("SELECT COUNT(*) as cnt FROM _sessions WHERE project_id = ?")
      .get(projectId!) as { cnt: number };
    const active = getDb()
      .prepare("SELECT COUNT(*) as cnt FROM _sessions WHERE project_id = ? AND status = 'active'")
      .get(projectId!) as { cnt: number };
    const durationRow = getDb()
      .prepare(
        `SELECT AVG((julianday(ended_at) - julianday(started_at)) * 86400000) as avg
         FROM _sessions WHERE project_id = ? AND status = 'ended' AND ended_at IS NOT NULL`,
      )
      .get(projectId!) as { avg: number | null };

    res.json({
      count: total.cnt,
      activeCount: active.cnt,
      avgDurationMs: durationRow.avg ?? 0,
    });
  } catch {
    res.json({ count: 0, activeCount: 0, avgDurationMs: 0 });
  }
});

// Context preview (what would be injected at sessionStart)
router.get("/api/:projectId/sessions/context-preview", (req: Request, res: Response) => {
  const { projectId } = req.params;
  assemble(projectId!, 4000)
    .then((result) => res.json(result))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    });
});

// Session context usage (existing endpoint)
router.get("/api/:projectId/sessions/:id/context-usage", (req: Request, res: Response) => {
  const { id } = req.params;
  const agent = typeof req.query["agent"] === "string" ? req.query["agent"] : "claude-code";
  res.json(getUsage(id!, agent));
});

// Session detail
router.get("/api/:projectId/sessions/:id", (req: Request, res: Response) => {
  const { id, projectId } = req.params;
  try {
    const row = getDb()
      .prepare("SELECT * FROM _sessions WHERE id = ? AND project_id = ?")
      .get(id!, projectId!) as SessionRow | undefined;
    if (!row) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({
      id: row.id,
      projectId: row.project_id,
      agent: row.agent,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      summary: row.summary,
      promptCount: row.prompt_count,
      toolCount: row.tool_count,
      errorCount: row.error_count,
    });
  } catch {
    res.status(404).json({ error: "Session not found" });
  }
});

// Session checkpoints
router.get("/api/:projectId/sessions/:id/checkpoints", (req: Request, res: Response) => {
  const { id } = req.params;
  res.json(getSessionCheckpoints(id!));
});

// Session timeline (cursor-based, merges multiple tables)
router.get("/api/:projectId/sessions/:id/timeline", (req: Request, res: Response) => {
  const { id, projectId } = req.params;
  const limit = typeof req.query["limit"] === "string" ? parseInt(req.query["limit"], 10) : 50;
  const after = typeof req.query["after"] === "string" ? req.query["after"] : undefined;

  const timeline: TimelineItem[] = [];

  // Newest-first: cursor points to oldest item on the previous page,
  // so next page fetches items strictly older than the cursor timestamp.
  const afterClause = after ? ` AND created_at < '${after}'` : "";

  try {
    const prompts = getDb()
      .prepare(
        `SELECT id, created_at, prompt_preview, intent_category, agent FROM _prompts
         WHERE session_id = ?${afterClause} ORDER BY created_at ASC LIMIT ?`,
      )
      .all(id!, limit) as Array<{ id: string; created_at: string; prompt_preview: string; intent_category: string; agent: string | null }>;
    for (const p of prompts) {
      timeline.push({
        type: "prompt",
        id: p.id,
        createdAt: p.created_at,
        data: { preview: p.prompt_preview, intentCategory: p.intent_category, agent: p.agent },
      });
    }
  } catch { /* table may not exist yet */ }

  try {
    const tools = getDb()
      .prepare(
        `SELECT id, created_at, tool_name, success, duration_ms FROM _tool_usage
         WHERE session_id = ?${afterClause} ORDER BY created_at ASC LIMIT ?`,
      )
      .all(id!, limit) as Array<{ id: string; created_at: string; tool_name: string; success: number; duration_ms: number | null }>;
    for (const t of tools) {
      timeline.push({
        type: "tool",
        id: t.id,
        createdAt: t.created_at,
        data: { toolName: t.tool_name, success: t.success === 1, durationMs: t.duration_ms },
      });
    }
  } catch { /* table may not exist yet */ }

  try {
    const errors = getDb()
      .prepare(
        `SELECT id, created_at, message, error_type FROM _agent_errors
         WHERE session_id = ?${afterClause} ORDER BY created_at ASC LIMIT ?`,
      )
      .all(id!, limit) as Array<{ id: string; created_at: string; message: string; error_type: string | null }>;
    for (const e of errors) {
      timeline.push({
        type: "error",
        id: e.id,
        createdAt: e.created_at,
        data: { message: e.message, errorType: e.error_type },
      });
    }
  } catch { /* table may not exist yet */ }

  try {
    const subagents = getDb()
      .prepare(
        `SELECT id, created_at, event_type, agent_type FROM _subagent_events
         WHERE session_id = ?${afterClause} ORDER BY created_at ASC LIMIT ?`,
      )
      .all(id!, limit) as Array<{ id: string; created_at: string; event_type: string; agent_type: string | null }>;
    for (const s of subagents) {
      timeline.push({
        type: "subagent",
        id: s.id,
        createdAt: s.created_at,
        data: { eventType: s.event_type, agentType: s.agent_type },
      });
    }
  } catch { /* table may not exist yet */ }

  try {
    const hookActivities = getDb()
      .prepare(
        `SELECT id, created_at, event, feature, success, error, duration_ms, output_snapshot FROM _hook_activity
         WHERE session_id = ?${afterClause} ORDER BY created_at ASC LIMIT ?`,
      )
      .all(id!, limit) as Array<{ id: string; created_at: string; event: string; feature: string; success: number; error: string | null; duration_ms: number; output_snapshot: string | null }>;
    for (const h of hookActivities) {
      let response: Record<string, unknown> | null = null;
      if (h.output_snapshot) {
        try { response = JSON.parse(h.output_snapshot) as Record<string, unknown>; } catch { /* truncated or invalid */ }
      }
      timeline.push({
        type: "hook",
        id: h.id,
        createdAt: h.created_at,
        data: {
          event: h.event,
          feature: h.feature,
          success: h.success === 1,
          durationMs: h.duration_ms,
          error: h.error ?? undefined,
          response,
        },
      });
    }
  } catch { /* table may not exist yet */ }

  try {
    const audits = getDb()
      .prepare(
        `SELECT id, created_at, tool_type, decision, reason FROM _tool_audit
         WHERE session_id = ?${afterClause} ORDER BY created_at ASC LIMIT ?`,
      )
      .all(id!, limit) as Array<{ id: string; created_at: string; tool_type: string; decision: string; reason: string | null }>;
    for (const a of audits) {
      timeline.push({
        type: "audit",
        id: a.id,
        createdAt: a.created_at,
        data: { toolType: a.tool_type, decision: a.decision, reason: a.reason },
      });
    }
  } catch { /* table may not exist yet */ }

  timeline.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sliced = timeline.slice(0, limit);
  // Next cursor is the oldest timestamp in this page (last item after DESC sort)
  const nextCursor = sliced.length === limit ? sliced[sliced.length - 1]!.createdAt : undefined;

  res.json({ items: sliced, nextCursor, projectId });
});

// Session summary stats
router.get("/api/:projectId/sessions/:id/summary", (req: Request, res: Response) => {
  const { id, projectId } = req.params;
  try {
    const row = getDb()
      .prepare(
        `SELECT id, prompt_count, tool_count, error_count, files_modified,
                started_at, ended_at, summary, agent, status
         FROM _sessions WHERE id = ? AND project_id = ?`,
      )
      .get(id!, projectId!) as SessionRow | undefined;

    if (!row) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    let files: string[] = [];
    try { files = JSON.parse(row.files_modified) as string[]; } catch { files = []; }

    const durationMs =
      row.ended_at
        ? new Date(row.ended_at).getTime() - new Date(row.started_at).getTime()
        : null;

    res.json({
      id: row.id,
      agent: row.agent,
      status: row.status,
      promptCount: row.prompt_count,
      toolCount: row.tool_count,
      errorCount: row.error_count,
      filesModified: files,
      summary: row.summary,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationMs,
    });
  } catch {
    res.status(404).json({ error: "Session not found" });
  }
});

export default router;
