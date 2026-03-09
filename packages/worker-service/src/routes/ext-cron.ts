import { Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import { logger } from "../core/logger.js";

// ---------------------------------------------------------------------------
// Module-level reference — set during app wiring (index.ts)
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

export function setExtCronDb(connection: Database.Database): void {
  db = connection;
}

function getDb(): Database.Database {
  if (!db) {
    throw new Error("ext-cron database not initialized");
  }
  return db;
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface JobRow {
  id: string;
  project_id: string;
  extension_name: string;
  job_name: string;
  cron_expression: string;
  timezone: string | null;
  enabled: number;
  description: string | null;
  timeout_ms: number | null;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  job_id: string;
  extension_name: string;
  project_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const router = Router();

/**
 * GET /api/:pid/ext-cron — List all extension cron jobs for a project
 */
router.get("/api/:pid/ext-cron", (req: Request, res: Response) => {
  const pid = String(req.params["pid"]);

  try {
    const rows = getDb().prepare(
      `SELECT * FROM _scheduler_jobs
       WHERE project_id = ?
       ORDER BY extension_name, created_at DESC`,
    ).all(pid) as JobRow[];

    const jobs = rows.map((row) => ({
      id: row.id,
      extensionName: row.extension_name,
      name: row.job_name,
      cron: row.cron_expression,
      timezone: row.timezone,
      enabled: row.enabled === 1,
      description: row.description,
      timeoutMs: row.timeout_ms,
      lastRunAt: row.last_run_at,
      lastRunStatus: row.last_run_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json(jobs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("ext-cron", `Failed to list cron jobs: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/:pid/ext-cron/:jobId/toggle — Toggle a cron job
 */
router.post("/api/:pid/ext-cron/:jobId/toggle", (req: Request, res: Response) => {
  const pid = String(req.params["pid"]);
  const jobId = String(req.params["jobId"]);
  const body = req.body as Record<string, unknown>;

  if (typeof body["enabled"] !== "boolean") {
    res.status(400).json({ error: "enabled (boolean) is required" });
    return;
  }

  try {
    const row = getDb().prepare(
      "SELECT * FROM _scheduler_jobs WHERE id = ? AND project_id = ?",
    ).get(jobId, pid) as JobRow | undefined;

    if (!row) {
      res.status(404).json({ error: "Cron job not found" });
      return;
    }

    const enabled = body["enabled"] as boolean;
    const now = new Date().toISOString();

    getDb().prepare(
      "UPDATE _scheduler_jobs SET enabled = ?, updated_at = ? WHERE id = ?",
    ).run(enabled ? 1 : 0, now, jobId);

    res.json({ id: jobId, enabled });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("ext-cron", `Failed to toggle cron job: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/:pid/ext-cron/:jobId/runs — Get run history for a cron job
 */
router.get("/api/:pid/ext-cron/:jobId/runs", (req: Request, res: Response) => {
  const pid = String(req.params["pid"]);
  const jobId = String(req.params["jobId"]);
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "20"), 10), 100);

  try {
    // Verify job exists and belongs to project
    const job = getDb().prepare(
      "SELECT id FROM _scheduler_jobs WHERE id = ? AND project_id = ?",
    ).get(jobId, pid) as { id: string } | undefined;

    if (!job) {
      res.status(404).json({ error: "Cron job not found" });
      return;
    }

    const rows = getDb().prepare(
      `SELECT * FROM _scheduler_runs
       WHERE job_id = ?
       ORDER BY started_at DESC
       LIMIT ?`,
    ).all(jobId, limit) as RunRow[];

    const runs = rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      error: row.error,
    }));

    res.json(runs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("ext-cron", `Failed to list cron runs: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

export default router;
