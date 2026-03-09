import { Router, type Request, type Response } from "express";
import { getStats } from "../middleware/request-tracker.js";

const router = Router();

// GET /api/:projectId/stats/api — query usage stats for the last hour
router.get("/api/:projectId/stats/api", (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.json(getStats(projectId!));
});

export default router;
