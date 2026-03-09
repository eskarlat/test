import { Router, type Request, type Response } from "express";
import { hookFeatureRegistry } from "../core/hook-feature-registry.js";
import { enqueueHook, getBatches, type HookEnqueueRequest } from "../core/hook-request-queue.js";
import { aggregateResults } from "../core/hook-response-aggregator.js";
import { generateHookFile } from "../services/hook-file-generator.js";
import { getRegistry as getProjectRegistry } from "./projects.js";
import { logger } from "../core/logger.js";
import { confirmFromExtension, detectFromPrompt } from "../core/observations-service.js";
import type { HookEvent } from "@renre-kit/extension-sdk";

const router = Router();

const hookActivity = new Map<string, HookActivityEntry[]>();
const ACTIVITY_MAX = 100;

interface HookActivityEntry {
  timestamp: string;
  event: string;
  feature: string;
  extensionName?: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

function recordActivity(projectId: string, entry: HookActivityEntry): void {
  let buf = hookActivity.get(projectId) ?? [];
  buf.push(entry);
  if (buf.length > ACTIVITY_MAX) buf = buf.slice(-ACTIVITY_MAX);
  hookActivity.set(projectId, buf);
}

function persistHookObservations(
  projectId: string,
  feature: string,
  observations: unknown[] | undefined,
): void {
  if (!observations || observations.length === 0) return;
  for (const obs of observations) {
    const o = obs as { content?: string; category?: string };
    if (typeof o.content === "string" && o.content.trim()) {
      confirmFromExtension(projectId, {
        content: o.content,
        source: `extension:${feature}`,
        category: o.category,
      });
    }
  }
}

function detectPromptObservations(
  event: HookEvent,
  projectId: string,
  input: unknown,
): void {
  if (event !== "userPromptSubmitted") return;
  const prompt = (input as { prompt?: string } | undefined)?.prompt;
  if (typeof prompt === "string") {
    detectFromPrompt(projectId, prompt);
  }
}

// POST /api/hooks/enqueue
router.post("/api/hooks/enqueue", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Partial<HookEnqueueRequest>;
  if (!body.batchId || !body.feature || !body.event || !body.projectId) {
    res.status(400).json({ error: "Missing required fields: batchId, feature, event, projectId" });
    return;
  }

  try {
    const result = await enqueueHook(body as HookEnqueueRequest);
    const featureDef = hookFeatureRegistry.resolve(body.feature);

    recordActivity(body.projectId, {
      timestamp: new Date().toISOString(),
      event: body.event,
      feature: body.feature,
      extensionName: featureDef?.extensionName,
      success: result.success,
      durationMs: result.durationMs,
      error: result.error,
    });

    const event = body.event as HookEvent;
    const response = aggregateResults(event, [result]);

    persistHookObservations(body.projectId, body.feature, response.observations);
    detectPromptObservations(event, body.projectId, body.input);

    res.json({ ok: true, result: result.output, aggregated: response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("hooks", `Enqueue failed: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// GET /api/hooks/features
router.get("/api/hooks/features", (_req: Request, res: Response) => {
  res.json(hookFeatureRegistry.listAll());
});

// POST /api/hooks/regenerate
router.post("/api/hooks/regenerate", async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.body as { projectId?: string };
  if (!projectId) {
    res.status(400).json({ error: "Missing projectId" });
    return;
  }
  const project = getProjectRegistry().get(projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  try {
    generateHookFile(project.path, hookFeatureRegistry.listAll());
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// GET /api/:projectId/hooks/activity
router.get("/api/:projectId/hooks/activity", (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.json(hookActivity.get(projectId!) ?? []);
});

// GET /api/:projectId/hooks/batches
router.get("/api/:projectId/hooks/batches", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const projectBatches = getBatches().filter((b) => b.projectId === projectId);
  const summary = projectBatches.map((b) => ({
    batchId: b.batchId,
    event: b.event,
    features: b.results.size,
    complete: b.complete,
    totalMs: b.complete
      ? Math.max(...Array.from(b.results.values()).map((r) => r.durationMs), 0)
      : null,
  }));
  res.json(summary);
});

export default router;
