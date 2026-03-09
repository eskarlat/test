import { Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import cron from "node-cron";
import type { AutomationEngine, CreateAutomationInput, UpdateAutomationInput, AutomationRunStatus } from "../core/automation-engine.js";
import type { CopilotBridge } from "../core/copilot-bridge.js";
import { logger } from "../core/logger.js";

// ---------------------------------------------------------------------------
// Module-level references — set during app wiring (index.ts)
// ---------------------------------------------------------------------------

let engine: AutomationEngine | null = null;
let bridge: CopilotBridge | null = null;
let db: Database.Database | null = null;

export function setAutomationEngine(ae: AutomationEngine): void {
  engine = ae;
}

export function setCopilotBridge(cb: CopilotBridge): void {
  bridge = cb;
}

export function setDb(d: Database.Database): void {
  db = d;
}

function getEngine(): AutomationEngine {
  if (!engine) {
    throw new Error("AutomationEngine not initialized");
  }
  return engine;
}

function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Last-run join query (richer than engine.listAutomations)
// ---------------------------------------------------------------------------

interface AutomationWithLastRunRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  enabled: number;
  schedule_type: string;
  schedule_cron: string | null;
  schedule_timezone: string | null;
  schedule_run_at: string | null;
  schedule_starts_at: string | null;
  schedule_ends_at: string | null;
  chain_json: string;
  system_prompt: string | null;
  variables_json: string | null;
  worktree_json: string | null;
  max_duration_ms: number | null;
  created_at: string;
  updated_at: string;
  last_run_status: string | null;
  last_run_at: string | null;
  last_run_duration: number | null;
}

interface LastRunInfo {
  status: string;
  startedAt: string;
  durationMs: number | null;
}

interface AutomationListItem {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  enabled: boolean;
  scheduleType: string;
  scheduleCron?: string;
  chainStepCount: number;
  createdAt: string;
  updatedAt: string;
  lastRun?: LastRunInfo;
}

function listAutomationsWithLastRun(projectId: string): AutomationListItem[] {
  if (!db) {
    throw new Error("Database not initialized");
  }

  const rows = db
    .prepare(
      `SELECT a.*,
              r.status AS last_run_status,
              r.started_at AS last_run_at,
              r.duration_ms AS last_run_duration
       FROM _automations a
       LEFT JOIN _automation_runs r ON r.automation_id = a.id
         AND r.started_at = (SELECT MAX(started_at) FROM _automation_runs WHERE automation_id = a.id)
       WHERE a.project_id = ?
       ORDER BY a.created_at DESC`,
    )
    .all(projectId) as AutomationWithLastRunRow[];

  return rows.map((row) => {
    const item: AutomationListItem = {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      enabled: row.enabled === 1,
      scheduleType: row.schedule_type,
      chainStepCount: (JSON.parse(row.chain_json) as unknown[]).length,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    if (row.description !== null) item.description = row.description;
    if (row.schedule_cron !== null) item.scheduleCron = row.schedule_cron;

    if (row.last_run_status !== null && row.last_run_at !== null) {
      const lastRun: LastRunInfo = {
        status: row.last_run_status,
        startedAt: row.last_run_at,
        durationMs: row.last_run_duration,
      };
      item.lastRun = lastRun;
    }

    return item;
  });
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

interface ValidationError {
  error: string;
}

function validateSchedule(body: Record<string, unknown>): ValidationError | null {
  if (!body["schedule"] || typeof body["schedule"] !== "object") {
    return { error: "schedule is required and must be an object" };
  }

  const schedule = body["schedule"] as Record<string, unknown>;
  const scheduleType = schedule["type"];
  if (!scheduleType || typeof scheduleType !== "string") {
    return { error: "schedule.type is required" };
  }
  if (!["cron", "once", "manual"].includes(scheduleType)) {
    return { error: "schedule.type must be one of: cron, once, manual" };
  }

  if (scheduleType === "cron") {
    const cronExpr = schedule["cron"];
    if (!cronExpr || typeof cronExpr !== "string") {
      return { error: "schedule.cron is required for cron schedule type" };
    }
    if (!cron.validate(cronExpr)) {
      return { error: `Invalid cron expression: ${cronExpr}` };
    }
  }

  return null;
}

const REQUIRED_STEP_STRINGS = ["name", "prompt", "model", "onError"] as const;
const VALID_ON_ERROR = new Set(["stop", "skip", "retry"]);

function validateStep(step: unknown, index: number): ValidationError | null {
  if (!step || typeof step !== "object") {
    return { error: `chain[${index}] must be an object` };
  }
  const s = step as Record<string, unknown>;

  for (const field of REQUIRED_STEP_STRINGS) {
    if (!s[field] || typeof s[field] !== "string") {
      return { error: `chain[${index}].${field} is required` };
    }
  }
  if (!s["tools"] || typeof s["tools"] !== "object") {
    return { error: `chain[${index}].tools is required` };
  }
  if (!VALID_ON_ERROR.has(s["onError"] as string)) {
    return { error: `chain[${index}].onError must be one of: stop, skip, retry` };
  }
  return null;
}

function validateCreateBody(
  body: Record<string, unknown>,
): ValidationError | null {
  if (!body["name"] || typeof body["name"] !== "string") {
    return { error: "name is required and must be a string" };
  }

  const scheduleErr = validateSchedule(body);
  if (scheduleErr) return scheduleErr;

  if (!body["chain"] || !Array.isArray(body["chain"])) {
    return { error: "chain is required and must be an array" };
  }

  const chain = body["chain"] as unknown[];
  if (chain.length === 0) {
    return { error: "chain must contain at least 1 step" };
  }

  for (let i = 0; i < chain.length; i++) {
    const stepErr = validateStep(chain[i], i);
    if (stepErr) return stepErr;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

// Static routes MUST come before parameterized /:id routes

// GET /api/:pid/automations — List automations with last run info
router.get("/api/:pid/automations/models", async (_req: Request, res: Response) => {
  if (!bridge) {
    res.status(503).json({ error: "Copilot bridge unavailable" });
    return;
  }

  try {
    const models = await bridge.listModels();
    res.json(models);
  } catch (err) {
    const msg = errorMsg(err);
    logger.error("automations", `Failed to list models: ${msg}`);
    res.status(503).json({ error: msg });
  }
});

router.get("/api/:pid/automations", (req: Request, res: Response) => {
  const pid = String(req.params["pid"]);
  try {
    const automations = listAutomationsWithLastRun(pid);
    res.json(automations);
  } catch (err) {
    const msg = errorMsg(err);
    logger.error("automations", `Failed to list automations: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// POST /api/:pid/automations — Create automation
router.post("/api/:pid/automations", (req: Request, res: Response) => {
  const pid = String(req.params["pid"]);
  const body = req.body as Record<string, unknown>;

  const validationError = validateCreateBody(body);
  if (validationError) {
    res.status(400).json(validationError);
    return;
  }

  try {
    const eng = getEngine();
    const input = body as unknown as CreateAutomationInput;
    const automation = eng.createAutomation(pid, input);
    res.status(201).json(automation);
  } catch (err) {
    const msg = errorMsg(err);
    if (msg.includes("Invalid cron") || msg.includes("is required")) {
      res.status(400).json({ error: msg });
      return;
    }
    logger.error("automations", `Failed to create automation: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// GET /api/:pid/automations/:id — Get automation details
router.get("/api/:pid/automations/:id", (req: Request, res: Response) => {
  const id = String(req.params["id"]);
  try {
    const eng = getEngine();
    const automation = eng.getAutomation(id);
    if (!automation) {
      res.status(404).json({ error: `Automation not found: ${id}` });
      return;
    }
    res.json(automation);
  } catch (err) {
    const msg = errorMsg(err);
    logger.error("automations", `Failed to get automation: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// PUT /api/:pid/automations/:id — Update automation
router.put("/api/:pid/automations/:id", (req: Request, res: Response) => {
  const id = String(req.params["id"]);
  const body = req.body as Record<string, unknown>;

  try {
    const eng = getEngine();
    const updates = body as unknown as UpdateAutomationInput;
    const automation = eng.updateAutomation(id, updates);
    res.json(automation);
  } catch (err) {
    const msg = errorMsg(err);
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg.includes("Invalid cron") || msg.includes("is required")) {
      res.status(400).json({ error: msg });
      return;
    }
    logger.error("automations", `Failed to update automation: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// DELETE /api/:pid/automations/:id — Delete automation
router.delete("/api/:pid/automations/:id", (req: Request, res: Response) => {
  const id = String(req.params["id"]);
  try {
    const eng = getEngine();

    // Verify it exists first
    const existing = eng.getAutomation(id);
    if (!existing) {
      res.status(404).json({ error: `Automation not found: ${id}` });
      return;
    }

    eng.deleteAutomation(id);
    res.status(204).send();
  } catch (err) {
    const msg = errorMsg(err);
    logger.error("automations", `Failed to delete automation: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// POST /api/:pid/automations/:id/toggle — Enable/disable
router.post("/api/:pid/automations/:id/toggle", (req: Request, res: Response) => {
  const id = String(req.params["id"]);
  const body = req.body as Record<string, unknown>;

  if (typeof body["enabled"] !== "boolean") {
    res.status(400).json({ error: "enabled (boolean) is required" });
    return;
  }

  try {
    const eng = getEngine();
    eng.toggleAutomation(id, body["enabled"] as boolean);
    res.json({ ok: true });
  } catch (err) {
    const msg = errorMsg(err);
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
      return;
    }
    logger.error("automations", `Failed to toggle automation: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// POST /api/:pid/automations/:id/trigger — Manually trigger
router.post("/api/:pid/automations/:id/trigger", (req: Request, res: Response) => {
  const id = String(req.params["id"]);
  try {
    const eng = getEngine();
    const runId = eng.triggerRun(id);
    res.status(202).json({ runId });
  } catch (err) {
    const msg = errorMsg(err);
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg.includes("already has an active run")) {
      res.status(409).json({ error: msg });
      return;
    }
    logger.error("automations", `Failed to trigger automation: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// GET /api/:pid/automations/:id/runs — List run history
router.get("/api/:pid/automations/:id/runs", (req: Request, res: Response) => {
  const id = String(req.params["id"]);
  try {
    const eng = getEngine();
    const opts: { status?: AutomationRunStatus; limit?: number } = {};
    const statusParam = req.query["status"];
    if (typeof statusParam === "string" && statusParam) {
      opts.status = statusParam as AutomationRunStatus;
    }
    const limitParam = req.query["limit"];
    if (typeof limitParam === "string" && limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        opts.limit = parsed;
      }
    }
    const runs = eng.listRuns(id, opts);
    res.json(runs);
  } catch (err) {
    const msg = errorMsg(err);
    logger.error("automations", `Failed to list runs: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// GET /api/:pid/automations/:id/runs/:runId — Get run details
router.get("/api/:pid/automations/:id/runs/:runId", (req: Request, res: Response) => {
  const runId = String(req.params["runId"]);
  try {
    const eng = getEngine();
    const run = eng.getRunDetails(runId);
    if (!run) {
      res.status(404).json({ error: `Run not found: ${runId}` });
      return;
    }
    res.json(run);
  } catch (err) {
    const msg = errorMsg(err);
    logger.error("automations", `Failed to get run details: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// POST /api/:pid/automations/:id/runs/:runId/cancel — Cancel running run
router.post("/api/:pid/automations/:id/runs/:runId/cancel", (req: Request, res: Response) => {
  const runId = String(req.params["runId"]);
  try {
    const eng = getEngine();
    eng.cancelRun(runId);
    res.json({ ok: true });
  } catch (err) {
    const msg = errorMsg(err);
    if (msg.includes("No active run found")) {
      res.status(404).json({ error: msg });
      return;
    }
    logger.error("automations", `Failed to cancel run: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

export default router;
