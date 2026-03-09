import { Router, type Request, type Response } from "express";
import {
  create,
  list,
  updateObservation,
  archiveObservation,
  deleteObservation,
  getObservationStats,
} from "../core/observations-service.js";

const router = Router();

router.get("/api/:projectId/observations", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const activeOnly = req.query["active"] !== "false";
  res.json(list(projectId!, activeOnly));
});

router.post("/api/:projectId/observations", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const body = req.body as Record<string, unknown>;

  const content = typeof body["content"] === "string" ? body["content"] : null;
  if (!content) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const source = typeof body["source"] === "string" ? body["source"] : "user";
  const category = typeof body["category"] === "string" ? body["category"] : "general";
  const confidence = typeof body["confidence"] === "number" ? body["confidence"] : 1.0;

  const obs = create(projectId!, content, source, category, confidence);
  if (!obs) {
    res.status(409).json({ error: "Duplicate observation" });
    return;
  }
  res.status(201).json(obs);
});

router.put("/api/:projectId/observations/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body as Record<string, unknown>;

  const updates: Parameters<typeof updateObservation>[1] = {};
  if (typeof body["content"] === "string") updates.content = body["content"];
  if (typeof body["category"] === "string") updates.category = body["category"];
  if (typeof body["confidence"] === "number") updates.confidence = body["confidence"];
  if (typeof body["active"] === "boolean") updates.active = body["active"];

  const obs = updateObservation(id!, updates);
  if (!obs) {
    res.status(404).json({ error: "Observation not found" });
    return;
  }
  res.json(obs);
});

router.delete("/api/:projectId/observations/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const obs = deleteObservation(id!);
  if (!obs) {
    res.status(404).json({ error: "Observation not found" });
    return;
  }
  res.json(obs);
});

router.get("/api/:projectId/observations/stats", (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.json(getObservationStats(projectId!));
});

export default router;
