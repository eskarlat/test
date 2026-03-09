import { Router, type Request, type Response } from "express";
import { getStatus } from "../core/mcp-manager.js";

const router = Router();

router.get("/api/:projectId/mcp/status", (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.json(getStatus(projectId!));
});

export default router;
