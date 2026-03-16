import { Router, type Request, type Response } from "express";
import {
  listPatterns,
  resolvePattern,
  ignorePattern,
  trends,
  getPatternStats,
  listErrors,
  type ErrorPattern,
} from "../core/error-intelligence.js";
import { dbManager } from "../core/db-manager.js";

const router = Router();

function toUiPattern(p: ErrorPattern) {
  return {
    id: p.fingerprint,
    projectId: p.projectId,
    fingerprint: p.fingerprint,
    messageTemplate: p.messageTemplate,
    occurrenceCount: p.occurrenceCount,
    sessionCount: p.sessionCount,
    status: p.status,
    resolutionNote: p.resolveNote ?? undefined,
    firstSeenAt: p.firstSeen,
    lastSeenAt: p.lastSeen,
  };
}

// GET /api/:projectId/errors — list patterns in UI shape
router.get("/api/:projectId/errors", (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.json(listPatterns(projectId!).map(toUiPattern));
});

// GET /api/:projectId/errors/trends — { date, count }[]
router.get("/api/:projectId/errors/trends", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const raw = trends(projectId!);
  res.json(raw.map((r) => ({ date: r.day, count: r.count })));
});

// PUT /api/:projectId/errors/:id — update pattern status/note
router.put("/api/:projectId/errors/:id", (req: Request, res: Response) => {
  const { projectId, id } = req.params;
  const body = req.body as Record<string, unknown>;
  const status = typeof body["status"] === "string" ? body["status"] : undefined;
  const note = typeof body["resolutionNote"] === "string" ? body["resolutionNote"] : "";

  if (status === "resolved") {
    resolvePattern(id!, note);
  } else if (status === "ignored") {
    ignorePattern(id!);
  } else if (status === "active") {
    try {
      dbManager
        .getConnection()
        .prepare("UPDATE _error_patterns SET status = 'active' WHERE fingerprint = ?")
        .run(id!);
    } catch {
      // non-fatal
    }
  }

  const updated = listPatterns(projectId!).find((p) => p.fingerprint === id);
  if (!updated) {
    res.status(404).json({ error: "Pattern not found" });
    return;
  }
  res.json(toUiPattern(updated));
});

// GET /api/:projectId/errors/intelligence — raw error events
router.get("/api/:projectId/errors/intelligence", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const limit = typeof req.query["limit"] === "string" ? parseInt(req.query["limit"], 10) : 50;
  const offset = typeof req.query["offset"] === "string" ? parseInt(req.query["offset"], 10) : 0;
  res.json(listErrors(projectId!, limit, offset));
});

// GET /api/:projectId/errors/patterns — alias kept for compatibility
router.get("/api/:projectId/errors/patterns", (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.json(listPatterns(projectId!).map(toUiPattern));
});

router.post(
  "/api/:projectId/errors/patterns/:fingerprint/resolve",
  (req: Request, res: Response) => {
    const { fingerprint } = req.params;
    const body = req.body as Record<string, unknown>;
    const note = typeof body["note"] === "string" ? body["note"] : "";
    const ok = resolvePattern(fingerprint!, note);
    if (!ok) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }
    res.json({ ok: true });
  },
);

router.post(
  "/api/:projectId/errors/patterns/:fingerprint/ignore",
  (req: Request, res: Response) => {
    const { fingerprint } = req.params;
    const ok = ignorePattern(fingerprint!);
    if (!ok) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }
    res.json({ ok: true });
  },
);

router.get("/api/:projectId/errors/patterns/stats", (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.json(getPatternStats(projectId!));
});

export default router;
