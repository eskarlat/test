import { Router, type Request, type Response } from "express";
import {
  listRules,
  addRule,
  updateRule,
  deleteRule,
  toggleRule,
  testPattern,
  getStats,
  listAuditLog,
} from "../core/tool-governance.js";

const router = Router();

router.get("/api/tool-rules", (_req: Request, res: Response) => {
  res.json(listRules("global"));
});

router.get("/api/:projectId/tool-rules", (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.json(listRules("project", projectId));
});

router.post("/api/tool-rules", (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const pattern = typeof body["pattern"] === "string" ? body["pattern"] : null;
  if (!pattern) {
    res.status(400).json({ error: "pattern is required" });
    return;
  }
  const decision = (["allow", "deny", "ask"].includes(body["decision"] as string)
    ? body["decision"]
    : "deny") as "allow" | "deny" | "ask";
  const toolType = typeof body["toolType"] === "string" ? body["toolType"] : null;
  const reason = typeof body["reason"] === "string" ? body["reason"] : null;
  const scope = body["scope"] === "project" ? "project" : "global";
  const projectId = typeof body["projectId"] === "string" ? body["projectId"] : null;

  const rule = addRule(projectId, pattern, decision, toolType, reason, scope);
  res.status(201).json(rule);
});

router.put("/api/tool-rules/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body as Record<string, unknown>;

  const updates: Parameters<typeof updateRule>[1] = {};
  if (typeof body["pattern"] === "string") updates.pattern = body["pattern"];
  if (["allow", "deny", "ask"].includes(body["decision"] as string)) {
    updates.decision = body["decision"] as "allow" | "deny" | "ask";
  }
  if (typeof body["toolType"] === "string") updates.toolType = body["toolType"];
  if (typeof body["reason"] === "string") updates.reason = body["reason"];
  if (typeof body["priority"] === "number") updates.priority = body["priority"];
  if (typeof body["enabled"] === "boolean") updates.enabled = body["enabled"];

  const ok = updateRule(id!, updates);
  if (!ok) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  res.json({ ok: true });
});

router.delete("/api/tool-rules/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const ok = deleteRule(id!);
  if (!ok) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  res.json({ ok: true });
});

router.post("/api/tool-rules/:id/toggle", (req: Request, res: Response) => {
  const { id } = req.params;
  const ok = toggleRule(id!);
  if (!ok) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  res.json({ ok: true });
});

router.post("/api/tool-rules/test", (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const pattern = typeof body["pattern"] === "string" ? body["pattern"] : null;
  const toolType = typeof body["toolType"] === "string" ? body["toolType"] : null;
  const toolInput = typeof body["toolInput"] === "string" ? body["toolInput"] : "";

  if (!pattern) {
    res.status(400).json({ error: "pattern is required" });
    return;
  }

  const matched = testPattern(pattern, toolType, toolInput);
  res.json({ matched });
});

router.get("/api/:projectId/tool-audit", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const limit = typeof req.query["limit"] === "string" ? parseInt(req.query["limit"], 10) : 50;
  const offset = typeof req.query["offset"] === "string" ? parseInt(req.query["offset"], 10) : 0;
  res.json(listAuditLog(projectId!, limit, offset));
});

router.get("/api/tool-rules/stats", (_req: Request, res: Response) => {
  res.json(getStats());
});

export default router;
