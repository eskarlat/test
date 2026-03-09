import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Server } from "socket.io";
import cron from "node-cron";
import { logger } from "./logger.js";
import type {
  CronJobOptions,
  CronJobInfo,
  CronJobRun,
  CronJobContext,
  ScopedDatabase,
  MCPClient,
  ExtensionLogger,
} from "@renre-kit/extension-sdk";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const SCHEDULER_LIMITS = {
  maxJobsPerExtension: 10,
  minIntervalMinutes: 1,
  maxConcurrentPerExtension: 2,
  maxConcurrentTotal: 10,
};

// Module-level tracking for global concurrency
let globalConcurrentCount = 0;

// ---------------------------------------------------------------------------
// Cron helpers
// ---------------------------------------------------------------------------

/**
 * Parse cron fields and compute a rough minimum interval in minutes.
 * Supports standard 5-field cron (minute hour dom month dow).
 * Returns Infinity for expressions that cannot be parsed.
 */
function estimateMinIntervalMinutes(expr: string): number {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return Infinity;

  const minuteField = parts[0]!;

  // Every minute: * or */1
  if (minuteField === "*" || minuteField === "*/1") return 1;

  // Step pattern: */N
  const stepMatch = /^\*\/(\d+)$/.exec(minuteField);
  if (stepMatch) return parseInt(stepMatch[1]!, 10);

  // Comma-separated list: find minimum gap
  if (minuteField.includes(",")) {
    const values = minuteField
      .split(",")
      .map((v) => parseInt(v, 10))
      .filter((v) => !isNaN(v))
      .sort((a, b) => a - b);
    if (values.length >= 2) {
      let minGap = 60;
      for (let i = 1; i < values.length; i++) {
        minGap = Math.min(minGap, values[i]! - values[i - 1]!);
      }
      return minGap;
    }
  }

  // Single value or range: once per hour minimum
  const hourField = parts[1]!;
  if (hourField === "*" || hourField.includes("/") || hourField.includes(",")) {
    return 60; // once per hour at most
  }

  return 1440; // once per day
}

/**
 * Compute a rough next run time from now based on the cron expression.
 * This is a best-effort approximation for display purposes.
 */
function computeNextRunAt(cronExpr: string, _timezone?: string): string | undefined {
  try {
    // Run a one-shot task and capture the next tick time
    // node-cron doesn't expose nextDate(), so we approximate
    const now = new Date();
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length < 5) return undefined;

    const next = computeNextFromFields(parts, now);
    return next ? next.toISOString() : undefined;
  } catch {
    return undefined;
  }
}

function computeNextFromFields(parts: string[], now: Date): Date | null {
  const minuteField = parts[0]!;
  const hourField = parts[1]!;

  // Simple cases: */N in minute field, * in hour field
  const stepMatch = /^\*\/(\d+)$/.exec(minuteField);
  if (stepMatch && (hourField === "*" || /^\*\/\d+$/.test(hourField))) {
    const step = parseInt(stepMatch[1]!, 10);
    const next = new Date(now);
    const currentMinute = next.getMinutes();
    const nextMinute = Math.ceil((currentMinute + 1) / step) * step;
    if (nextMinute >= 60) {
      next.setHours(next.getHours() + 1);
      next.setMinutes(nextMinute % 60);
    } else {
      next.setMinutes(nextMinute);
    }
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }

  // Every minute
  if (minuteField === "*") {
    const next = new Date(now.getTime() + 60_000);
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }

  // Fixed minute value
  const fixedMin = parseInt(minuteField, 10);
  if (!isNaN(fixedMin)) {
    const next = new Date(now);
    next.setSeconds(0);
    next.setMilliseconds(0);
    if (next.getMinutes() >= fixedMin) {
      next.setHours(next.getHours() + 1);
    }
    next.setMinutes(fixedMin);
    return next;
  }

  return null;
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
// ScopedScheduler
// ---------------------------------------------------------------------------

export interface SchedulerExtensionContext {
  db: ScopedDatabase | null;
  logger: ExtensionLogger;
  config: Record<string, string>;
  mcp: MCPClient | null;
}

export class ScopedScheduler {
  private readonly db: Database.Database;
  private readonly io: Server;
  private readonly extensionName: string;
  private readonly projectId: string;
  private readonly extCtx: SchedulerExtensionContext;

  // Active cron tasks keyed by job ID
  private readonly activeTasks = new Map<string, cron.ScheduledTask>();
  // Registered callbacks keyed by job ID
  private readonly callbacks = new Map<string, (ctx: CronJobContext) => Promise<void>>();
  // Active AbortControllers for running executions
  private readonly activeAborts = new Map<string, AbortController>();
  // Per-extension concurrent run count
  private concurrentCount = 0;

  constructor(
    db: Database.Database,
    io: Server,
    extensionName: string,
    projectId: string,
    extCtx: SchedulerExtensionContext,
  ) {
    this.db = db;
    this.io = io;
    this.extensionName = extensionName;
    this.projectId = projectId;
    this.extCtx = extCtx;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async register(opts: CronJobOptions): Promise<string> {
    this.validateCronExpression(opts.cron);
    this.enforceMinInterval(opts.cron);
    this.enforceMaxJobs();

    const id = randomUUID();
    const now = new Date().toISOString();

    const enabled = opts.enabled !== false;

    this.db.prepare(
      `INSERT INTO _scheduler_jobs
       (id, project_id, extension_name, job_name, cron_expression, timezone,
        enabled, description, timeout_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      this.projectId,
      this.extensionName,
      opts.name,
      opts.cron,
      opts.timezone ?? null,
      enabled ? 1 : 0,
      opts.description ?? null,
      opts.timeoutMs ?? 60000,
      now,
      now,
    );

    this.callbacks.set(id, opts.callback);

    if (enabled) {
      this.scheduleTask(id, opts.cron, opts.timezone);
    }

    this.emitEvent("scheduler:job-registered", { jobId: id, name: opts.name });
    logger.info(
      `scheduler:${this.extensionName}`,
      `Registered cron job "${opts.name}" (${opts.cron}) [${id}]`,
    );

    return id;
  }

  async cancel(jobId: string): Promise<void> {
    this.assertOwnership(jobId);
    this.stopTask(jobId);
    this.callbacks.delete(jobId);

    // Abort any running execution
    const ac = this.activeAborts.get(jobId);
    if (ac) {
      ac.abort();
      this.activeAborts.delete(jobId);
    }

    this.db.prepare("DELETE FROM _scheduler_jobs WHERE id = ?").run(jobId);
    this.emitEvent("scheduler:job-cancelled", { jobId });
    logger.info(`scheduler:${this.extensionName}`, `Cancelled cron job [${jobId}]`);
  }

  async toggle(jobId: string, enabled: boolean): Promise<void> {
    this.assertOwnership(jobId);

    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE _scheduler_jobs SET enabled = ?, updated_at = ? WHERE id = ?",
    ).run(enabled ? 1 : 0, now, jobId);

    if (enabled) {
      const row = this.getJobRow(jobId);
      if (row) {
        this.scheduleTask(jobId, row.cron_expression, row.timezone ?? undefined);
      }
    } else {
      this.stopTask(jobId);
    }

    this.emitEvent("scheduler:job-toggled", { jobId, enabled });
    logger.info(
      `scheduler:${this.extensionName}`,
      `Toggled cron job [${jobId}] enabled=${enabled}`,
    );
  }

  async list(): Promise<CronJobInfo[]> {
    const rows = this.db.prepare(
      `SELECT * FROM _scheduler_jobs
       WHERE extension_name = ? AND project_id = ?
       ORDER BY created_at DESC`,
    ).all(this.extensionName, this.projectId) as JobRow[];

    return rows.map((row) => this.mapJobRowToInfo(row));
  }

  async runs(jobId: string, opts?: { limit?: number }): Promise<CronJobRun[]> {
    this.assertOwnership(jobId);
    const limit = opts?.limit ?? 20;

    const rows = this.db.prepare(
      `SELECT * FROM _scheduler_runs
       WHERE job_id = ?
       ORDER BY started_at DESC
       LIMIT ?`,
    ).all(jobId, limit) as RunRow[];

    return rows.map((row) => this.mapRunRow(row));
  }

  // -------------------------------------------------------------------------
  // Lifecycle methods (called by extension-loader)
  // -------------------------------------------------------------------------

  loadAndSchedule(): void {
    const rows = this.db.prepare(
      `SELECT * FROM _scheduler_jobs
       WHERE extension_name = ? AND project_id = ? AND enabled = 1`,
    ).all(this.extensionName, this.projectId) as JobRow[];

    for (const row of rows) {
      if (!this.callbacks.has(row.id)) continue;
      this.scheduleTask(row.id, row.cron_expression, row.timezone ?? undefined);
    }

    if (rows.length > 0) {
      logger.info(
        `scheduler:${this.extensionName}`,
        `Loaded ${rows.length} enabled cron job(s) for project ${this.projectId}`,
      );
    }
  }

  pauseAll(): void {
    for (const [jobId, task] of this.activeTasks) {
      task.stop();
      this.activeTasks.delete(jobId);
    }

    // Abort all running executions
    for (const [jobId, ac] of this.activeAborts) {
      ac.abort();
      this.activeAborts.delete(jobId);
    }

    logger.info(
      `scheduler:${this.extensionName}`,
      `Paused all cron jobs for project ${this.projectId}`,
    );
  }

  stopAll(): void {
    this.pauseAll();
    this.callbacks.clear();
  }

  // -------------------------------------------------------------------------
  // Job execution
  // -------------------------------------------------------------------------

  async executeJob(jobId: string): Promise<void> {
    const row = this.getJobRow(jobId);
    if (!row) return;

    if (!this.canStartExecution()) {
      logger.warn(
        `scheduler:${this.extensionName}`,
        `Skipping job [${jobId}] — concurrency limit reached`,
      );
      return;
    }

    const callback = this.callbacks.get(jobId);
    if (!callback) {
      logger.warn(
        `scheduler:${this.extensionName}`,
        `No callback registered for job [${jobId}]`,
      );
      return;
    }

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const timeoutMs = row.timeout_ms ?? 60000;

    // Insert run record
    this.db.prepare(
      `INSERT INTO _scheduler_runs
       (id, job_id, extension_name, project_id, status, started_at)
       VALUES (?, ?, ?, ?, 'running', ?)`,
    ).run(runId, jobId, this.extensionName, this.projectId, startedAt);

    this.concurrentCount++;
    globalConcurrentCount++;

    const ac = new AbortController();
    this.activeAborts.set(jobId, ac);

    const timeout = setTimeout(() => ac.abort(), timeoutMs);

    const ctx: CronJobContext = {
      jobId,
      projectId: this.projectId,
      db: this.extCtx.db,
      logger: this.extCtx.logger,
      config: this.extCtx.config,
      mcp: this.extCtx.mcp,
      signal: ac.signal,
    };

    try {
      await callback(ctx);
      this.completeRun(runId, jobId, startedAt, "completed");
    } catch (err) {
      const timedOut = ac.signal.aborted;
      const status = timedOut ? "timed_out" : "failed";
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.completeRun(runId, jobId, startedAt, status, errorMsg);
    } finally {
      clearTimeout(timeout);
      this.activeAborts.delete(jobId);
      this.concurrentCount--;
      globalConcurrentCount--;
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private completeRun(
    runId: string,
    jobId: string,
    startedAt: string,
    status: "completed" | "failed" | "timed_out",
    error?: string,
  ): void {
    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    this.db.prepare(
      `UPDATE _scheduler_runs
       SET status = ?, completed_at = ?, duration_ms = ?, error = ?
       WHERE id = ?`,
    ).run(status, completedAt, durationMs, error ?? null, runId);

    this.db.prepare(
      `UPDATE _scheduler_jobs
       SET last_run_at = ?, last_run_status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(completedAt, status, completedAt, jobId);

    this.emitEvent("scheduler:run-completed", { runId, jobId, status });

    if (status === "completed") {
      logger.info(
        `scheduler:${this.extensionName}`,
        `Job [${jobId}] completed in ${durationMs}ms`,
      );
    } else {
      logger.warn(
        `scheduler:${this.extensionName}`,
        `Job [${jobId}] ${status}: ${error ?? "unknown error"}`,
      );
    }
  }

  private scheduleTask(jobId: string, cronExpr: string, timezone?: string): void {
    // Stop existing task if any
    this.stopTask(jobId);

    const handler = () => { this.executeJob(jobId).catch(() => { /* handled in executeJob */ }); };
    const task = timezone !== undefined
      ? cron.schedule(cronExpr, handler, { timezone })
      : cron.schedule(cronExpr, handler);

    this.activeTasks.set(jobId, task);
  }

  private stopTask(jobId: string): void {
    const task = this.activeTasks.get(jobId);
    if (task) {
      task.stop();
      this.activeTasks.delete(jobId);
    }
  }

  private validateCronExpression(expr: string): void {
    if (!cron.validate(expr)) {
      throw new Error(`Invalid cron expression: "${expr}"`);
    }
  }

  private enforceMinInterval(expr: string): void {
    const interval = estimateMinIntervalMinutes(expr);
    if (interval < SCHEDULER_LIMITS.minIntervalMinutes) {
      throw new Error(
        `Cron interval too frequent: estimated ${interval} min, minimum is ${SCHEDULER_LIMITS.minIntervalMinutes} min`,
      );
    }
  }

  private enforceMaxJobs(): void {
    const count = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM _scheduler_jobs
       WHERE extension_name = ? AND project_id = ?`,
    ).get(this.extensionName, this.projectId) as { cnt: number };

    if (count.cnt >= SCHEDULER_LIMITS.maxJobsPerExtension) {
      throw new Error(
        `Maximum cron jobs per extension reached (${SCHEDULER_LIMITS.maxJobsPerExtension})`,
      );
    }
  }

  private canStartExecution(): boolean {
    if (this.concurrentCount >= SCHEDULER_LIMITS.maxConcurrentPerExtension) return false;
    if (globalConcurrentCount >= SCHEDULER_LIMITS.maxConcurrentTotal) return false;
    return true;
  }

  private assertOwnership(jobId: string): void {
    const row = this.db.prepare(
      `SELECT extension_name FROM _scheduler_jobs WHERE id = ?`,
    ).get(jobId) as { extension_name: string } | undefined;

    if (!row) {
      throw new Error(`Cron job not found: ${jobId}`);
    }
    if (row.extension_name !== this.extensionName) {
      throw new Error(
        `Extension "${this.extensionName}" does not own cron job "${jobId}"`,
      );
    }
  }

  private getJobRow(jobId: string): JobRow | null {
    const row = this.db.prepare(
      "SELECT * FROM _scheduler_jobs WHERE id = ?",
    ).get(jobId) as JobRow | undefined;
    return row ?? null;
  }

  private mapJobRowToInfo(row: JobRow): CronJobInfo {
    const info: CronJobInfo = {
      id: row.id,
      name: row.job_name,
      cron: row.cron_expression,
      enabled: row.enabled === 1,
    };

    if (row.timezone) info.timezone = row.timezone;
    if (row.description) info.description = row.description;
    if (row.last_run_at) info.lastRunAt = row.last_run_at;
    if (row.last_run_status) info.lastRunStatus = row.last_run_status;

    const nextRun = computeNextRunAt(row.cron_expression, row.timezone ?? undefined);
    if (nextRun) info.nextRunAt = nextRun;

    return info;
  }

  private mapRunRow(row: RunRow): CronJobRun {
    const run: CronJobRun = {
      id: row.id,
      jobId: row.job_id,
      status: row.status as CronJobRun["status"],
      startedAt: row.started_at,
    };

    if (row.completed_at) run.completedAt = row.completed_at;
    if (row.duration_ms !== null) run.durationMs = row.duration_ms;
    if (row.error) run.error = row.error;

    return run;
  }

  private emitEvent(event: string, data: Record<string, unknown>): void {
    try {
      this.io
        .to(`project:${this.projectId}`)
        .emit(event, { ...data, projectId: this.projectId, extensionName: this.extensionName });
    } catch {
      // Socket.IO emission failure is non-fatal
    }
  }
}

// ---------------------------------------------------------------------------
// Test helper — reset global concurrent count
// ---------------------------------------------------------------------------

export function _resetGlobalConcurrentCount(): void {
  globalConcurrentCount = 0;
}
