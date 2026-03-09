import { Router, type Request, type Response } from "express";
import { logger } from "../core/logger.js";

const router = Router();

interface ErrorReport {
  source: string;
  type: string;
  error: string;
  stack?: string;
  context?: Record<string, unknown>;
}

router.post("/api/errors", (req: Request, res: Response) => {
  const report = req.body as ErrorReport;
  if (!report.source || !report.error) {
    res.status(400).json({ error: "Missing required fields: source, error" });
    return;
  }

  logger.error(report.source, report.error, {
    type: report.type,
    // stack omitted from structured log to avoid noise
    context: report.context,
  });

  res.json({ ok: true });
});

export default router;
