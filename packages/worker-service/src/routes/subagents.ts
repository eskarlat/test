import { Router, type Request, type Response } from "express";
import { list, getTree, analytics } from "../core/subagent-tracking.js";

const router = Router();

router.get("/api/:projectId/subagents", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const limit = typeof req.query["limit"] === "string" ? parseInt(req.query["limit"], 10) : 50;
  res.json(list(projectId!, limit));
});

router.get("/api/:projectId/subagents/tree/:sessionId", (req: Request, res: Response) => {
  const { projectId, sessionId } = req.params;
  res.json(getTree(projectId!, sessionId!));
});

router.get("/api/:projectId/subagents/analytics", (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.json(analytics(projectId!));
});

export default router;
