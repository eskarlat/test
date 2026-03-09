import { Router, type Request, type Response } from "express";
import {
  listUsage,
  getAnalytics,
  getSessionAnalytics,
  getStats,
  listWarnings,
} from "../core/tool-analytics.js";

const router = Router();

router.get("/api/:projectId/tools/usage", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const limit = typeof req.query["limit"] === "string" ? parseInt(req.query["limit"], 10) : 50;
  const offset = typeof req.query["offset"] === "string" ? parseInt(req.query["offset"], 10) : 0;
  res.json(listUsage(projectId!, limit, offset));
});

router.get("/api/:projectId/tools/analytics", (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.json(getAnalytics(projectId!));
});

router.get(
  "/api/:projectId/tools/analytics/session/:sessionId",
  (req: Request, res: Response) => {
    const { projectId, sessionId } = req.params;
    res.json(getSessionAnalytics(projectId!, sessionId!));
  },
);

router.get("/api/:projectId/tools/stats", (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.json(getStats(projectId!));
});

router.get("/api/:projectId/tools/warnings", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const limit = typeof req.query["limit"] === "string" ? parseInt(req.query["limit"], 10) : 50;
  res.json(listWarnings(projectId!, limit));
});

export default router;
