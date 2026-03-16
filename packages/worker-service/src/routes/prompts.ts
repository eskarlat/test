import { Router, type Request, type Response } from "express";
import { list, analytics, search, type PromptRecord } from "../core/prompt-journal.js";
import { dbManager } from "../core/db-manager.js";

const router = Router();

function toUiPrompt(r: PromptRecord) {
  return {
    id: r.id,
    projectId: r.projectId,
    sessionId: r.sessionId ?? undefined,
    agent: r.agent ?? "unknown",
    intent: r.intentCategory,
    promptPreview: r.promptPreview,
    tokenCount: Math.ceil(r.promptPreview.length / 4),
    createdAt: r.createdAt,
  };
}

router.get("/api/:projectId/prompts", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const limit = typeof req.query["limit"] === "string" ? parseInt(req.query["limit"], 10) : 50;
  const offset = typeof req.query["offset"] === "string" ? parseInt(req.query["offset"], 10) : 0;
  const q = typeof req.query["q"] === "string" ? req.query["q"] : undefined;

  if (q) {
    res.json(search(projectId!, q).map(toUiPrompt));
    return;
  }

  res.json(list(projectId!, limit, offset).map(toUiPrompt));
});

router.get("/api/:projectId/prompts/analytics", (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.json(analytics(projectId!));
});

router.get("/api/:projectId/prompts/stats", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const base = analytics(projectId!);

  const byAgent: Record<string, number> = {};
  try {
    const rows = dbManager
      .getConnection()
      .prepare(
        "SELECT agent, COUNT(*) as cnt FROM _prompts WHERE project_id = ? AND agent IS NOT NULL GROUP BY agent",
      )
      .all(projectId!) as Array<{ agent: string; cnt: number }>;
    for (const r of rows) byAgent[r.agent] = r.cnt;
  } catch {
    // non-fatal
  }

  res.json({ total: base.total, byIntent: base.byCategory, byAgent });
});

export default router;
