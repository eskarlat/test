import { Router, type Request, type Response } from "express";
import type {
  WorktreeManager,
  WorktreeCreator,
  WorktreeCreateOptions,
} from "../core/worktree-manager.js";
import { logger } from "../core/logger.js";

// ---------------------------------------------------------------------------
// Module-level reference — set during app wiring (index.ts)
// ---------------------------------------------------------------------------

let manager: WorktreeManager | null = null;

export function setWorktreeManager(wm: WorktreeManager): void {
  manager = wm;
}

function getManager(): WorktreeManager {
  if (!manager) {
    throw new Error("WorktreeManager not initialized");
  }
  return manager;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_CREATOR_TYPES = new Set(["automation", "chat", "user"]);

function buildCreator(raw: Record<string, unknown>): WorktreeCreator {
  const creator: WorktreeCreator = {
    type: String(raw["type"]) as "automation" | "chat" | "user",
  };
  if (typeof raw["automationId"] === "string") creator.automationId = raw["automationId"];
  if (typeof raw["automationRunId"] === "string") creator.automationRunId = raw["automationRunId"];
  if (typeof raw["chatSessionId"] === "string") creator.chatSessionId = raw["chatSessionId"];
  return creator;
}

function assignOptionalFields(opts: WorktreeCreateOptions, body: Record<string, unknown>): void {
  if (typeof body["branch"] === "string") opts.branch = body["branch"];
  if (typeof body["createBranch"] === "boolean") opts.createBranch = body["createBranch"];
  if (typeof body["baseBranch"] === "string") opts.baseBranch = body["baseBranch"];
  if (typeof body["ttlMs"] === "number") opts.ttlMs = body["ttlMs"];
  if (typeof body["metadata"] === "object" && body["metadata"] !== null) {
    opts.metadata = body["metadata"] as Record<string, string>;
  }
}

function parseCreateBody(
  pid: string,
  body: Record<string, unknown>,
): { opts: WorktreeCreateOptions } | { error: string } {
  if (!body["cleanupPolicy"] || typeof body["cleanupPolicy"] !== "string") {
    return { error: "cleanupPolicy is required" };
  }
  if (!body["createdBy"] || typeof body["createdBy"] !== "object") {
    return { error: "createdBy is required" };
  }

  const raw = body["createdBy"] as Record<string, unknown>;
  if (!VALID_CREATOR_TYPES.has(String(raw["type"]))) {
    return { error: "createdBy.type must be one of: automation, chat, user" };
  }
  if (String(raw["type"]) !== "automation" && !body["branch"]) {
    return { error: "branch is required for non-automation worktrees" };
  }

  const opts: WorktreeCreateOptions = {
    projectId: pid,
    cleanupPolicy: body["cleanupPolicy"] as "always" | "on_success" | "never" | "ttl",
    createdBy: buildCreator(raw),
  };
  assignOptionalFields(opts, body);
  return { opts };
}

function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Project-scoped worktree routes
// ---------------------------------------------------------------------------

const router = Router();

// Static routes MUST come before parameterized /:id routes (ADR-051 §6)

router.post("/api/:pid/worktrees/cleanup", async (_req: Request, res: Response) => {
  try {
    const result = await getManager().runCleanup();
    res.json(result);
  } catch (err) {
    const msg = errorMsg(err);
    logger.error("worktrees", `Cleanup failed: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

router.get("/api/:pid/worktrees/disk-usage", async (req: Request, res: Response) => {
  const pid = String(req.params["pid"]);
  try {
    const wm = getManager();
    const totalBytes = wm.totalDiskUsage(pid);
    const worktrees = await wm.list(pid);
    res.json({ totalBytes, worktreeCount: worktrees.length });
  } catch (err) {
    const msg = errorMsg(err);
    logger.error("worktrees", `Failed to get disk usage: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

router.get("/api/:pid/worktrees", async (req: Request, res: Response) => {
  const pid = String(req.params["pid"]);
  try {
    const worktrees = await getManager().list(pid);
    res.json(worktrees);
  } catch (err) {
    const msg = errorMsg(err);
    logger.error("worktrees", `Failed to list worktrees: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

router.post("/api/:pid/worktrees", async (req: Request, res: Response) => {
  const pid = String(req.params["pid"]);
  const parsed = parseCreateBody(pid, req.body as Record<string, unknown>);

  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  try {
    const worktree = await getManager().create(parsed.opts);
    res.status(201).json(worktree);
  } catch (err) {
    const msg = errorMsg(err);
    if (msg.includes("already checked out")) {
      res.status(409).json({ error: msg });
      return;
    }
    logger.error("worktrees", `Failed to create worktree: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// Parameterized routes AFTER static routes

router.get("/api/:pid/worktrees/:id", async (req: Request, res: Response) => {
  const id = String(req.params["id"]);
  try {
    const worktree = await getManager().get(id);
    res.json(worktree);
  } catch (err) {
    const msg = errorMsg(err);
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
      return;
    }
    logger.error("worktrees", `Failed to get worktree: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

router.delete("/api/:pid/worktrees/:id", async (req: Request, res: Response) => {
  const id = String(req.params["id"]);
  try {
    await getManager().remove(id);
    res.status(204).send();
  } catch (err) {
    const msg = errorMsg(err);
    if (msg.includes("in_use") || msg.includes("in use")) {
      res.status(409).json({ error: msg });
      return;
    }
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
      return;
    }
    logger.error("worktrees", `Failed to remove worktree: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

router.get("/api/:pid/worktrees/:id/status", async (req: Request, res: Response) => {
  const id = String(req.params["id"]);
  try {
    const wm = getManager();
    const diskUsageBytes = await wm.updateDiskUsage(id);
    const worktree = await wm.get(id);
    res.json({
      status: worktree.status,
      diskUsageBytes,
      lastAccessedAt: worktree.lastAccessedAt,
    });
  } catch (err) {
    const msg = errorMsg(err);
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
      return;
    }
    logger.error("worktrees", `Failed to get worktree status: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

export default router;
