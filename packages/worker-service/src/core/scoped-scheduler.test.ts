import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ScopedScheduler, _resetGlobalConcurrentCount } from "./scoped-scheduler.js";
import type { CronJobContext } from "@renre-kit/extension-sdk";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// eslint-disable-next-line sonarjs/publicly-writable-directories
vi.mock("./paths.js", () => ({
  // eslint-disable-next-line sonarjs/publicly-writable-directories
  globalPaths: () => ({
    globalDir: "/tmp/renre-kit-test", // eslint-disable-line sonarjs/publicly-writable-directories
    configFile: "/tmp/renre-kit-test/config.json", // eslint-disable-line sonarjs/publicly-writable-directories
    dataDb: "/tmp/renre-kit-test/data.db", // eslint-disable-line sonarjs/publicly-writable-directories
    logsDir: "/tmp/renre-kit-test/logs", // eslint-disable-line sonarjs/publicly-writable-directories
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCHEDULER_MIGRATION = readFileSync(
  join(__dirname, "..", "migrations", "core", "008_scheduler.up.sql"),
  "utf8",
);

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode=WAL");
  db.pragma("foreign_keys=ON");
  db.exec(SCHEDULER_MIGRATION);
  return db;
}

function createMockIO() {
  const emitFn = vi.fn();
  const toFn = vi.fn().mockReturnValue({ emit: emitFn });
  return {
    to: toFn,
    emit: emitFn,
    _toFn: toFn,
    _emitFn: emitFn,
  };
}

function createMockExtCtx() {
  return {
    db: null,
    logger: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
    config: {} as Record<string, string>,
    mcp: null,
  };
}

function makeScheduler(
  db: Database.Database,
  io: ReturnType<typeof createMockIO>,
  extensionName = "test-ext",
  projectId = "proj-1",
): ScopedScheduler {
  return new ScopedScheduler(
    db,
    io as unknown as import("socket.io").Server,
    extensionName,
    projectId,
    createMockExtCtx(),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ScopedScheduler", () => {
  let db: Database.Database;
  let mockIO: ReturnType<typeof createMockIO>;
  let scheduler: ScopedScheduler;

  beforeEach(() => {
    db = createTestDb();
    mockIO = createMockIO();
    _resetGlobalConcurrentCount();
    scheduler = makeScheduler(db, mockIO);
  });

  afterEach(() => {
    scheduler.stopAll();
    db.close();
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // register()
  // -----------------------------------------------------------------------

  describe("register()", () => {
    it("registers a cron job and returns an id", async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      const id = await scheduler.register({
        name: "my-job",
        cron: "*/5 * * * *",
        callback,
        description: "Every 5 minutes",
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe("string");

      // Verify DB row
      const row = db.prepare("SELECT * FROM _scheduler_jobs WHERE id = ?").get(id) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row["job_name"]).toBe("my-job");
      expect(row["cron_expression"]).toBe("*/5 * * * *");
      expect(row["extension_name"]).toBe("test-ext");
      expect(row["project_id"]).toBe("proj-1");
      expect(row["enabled"]).toBe(1);
      expect(row["description"]).toBe("Every 5 minutes");

      // Verify Socket.IO emission
      expect(mockIO._toFn).toHaveBeenCalledWith("project:proj-1");
      expect(mockIO._emitFn).toHaveBeenCalledWith(
        "scheduler:job-registered",
        expect.objectContaining({ jobId: id, name: "my-job" }),
      );
    });

    it("registers a disabled job when enabled=false", async () => {
      const id = await scheduler.register({
        name: "disabled-job",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
        enabled: false,
      });

      const row = db.prepare("SELECT enabled FROM _scheduler_jobs WHERE id = ?").get(id) as { enabled: number };
      expect(row.enabled).toBe(0);
    });

    it("rejects invalid cron expression", async () => {
      await expect(
        scheduler.register({
          name: "bad-cron",
          cron: "not-a-cron",
          callback: vi.fn().mockResolvedValue(undefined),
        }),
      ).rejects.toThrow("Invalid cron expression");
    });

    it("enforces max jobs limit", async () => {
      // Register 10 jobs
      for (let i = 0; i < 10; i++) {
        await scheduler.register({
          name: `job-${i}`,
          cron: "0 * * * *",
          callback: vi.fn().mockResolvedValue(undefined),
        });
      }

      // 11th should fail
      await expect(
        scheduler.register({
          name: "job-overflow",
          cron: "0 * * * *",
          callback: vi.fn().mockResolvedValue(undefined),
        }),
      ).rejects.toThrow("Maximum cron jobs per extension reached");
    });

    it("uses custom timeout_ms", async () => {
      const id = await scheduler.register({
        name: "custom-timeout",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
        timeoutMs: 120000,
      });

      const row = db.prepare("SELECT timeout_ms FROM _scheduler_jobs WHERE id = ?").get(id) as { timeout_ms: number };
      expect(row.timeout_ms).toBe(120000);
    });

    it("uses timezone when provided", async () => {
      const id = await scheduler.register({
        name: "tz-job",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
        timezone: "America/New_York",
      });

      const row = db.prepare("SELECT timezone FROM _scheduler_jobs WHERE id = ?").get(id) as { timezone: string };
      expect(row.timezone).toBe("America/New_York");
    });
  });

  // -----------------------------------------------------------------------
  // cancel()
  // -----------------------------------------------------------------------

  describe("cancel()", () => {
    it("cancels a registered job", async () => {
      const id = await scheduler.register({
        name: "to-cancel",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });

      await scheduler.cancel(id);

      const row = db.prepare("SELECT * FROM _scheduler_jobs WHERE id = ?").get(id);
      expect(row).toBeUndefined();

      expect(mockIO._emitFn).toHaveBeenCalledWith(
        "scheduler:job-cancelled",
        expect.objectContaining({ jobId: id }),
      );
    });

    it("throws on non-existent job", async () => {
      await expect(scheduler.cancel("nonexistent")).rejects.toThrow("Cron job not found");
    });

    it("throws when cancelling another extension's job", async () => {
      // Insert a job from a different extension
      db.prepare(
        `INSERT INTO _scheduler_jobs
         (id, project_id, extension_name, job_name, cron_expression, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run("other-job", "proj-1", "other-ext", "job-1", "0 * * * *", new Date().toISOString(), new Date().toISOString());

      await expect(scheduler.cancel("other-job")).rejects.toThrow("does not own");
    });
  });

  // -----------------------------------------------------------------------
  // toggle()
  // -----------------------------------------------------------------------

  describe("toggle()", () => {
    it("disables an enabled job", async () => {
      const id = await scheduler.register({
        name: "toggle-test",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });

      await scheduler.toggle(id, false);

      const row = db.prepare("SELECT enabled FROM _scheduler_jobs WHERE id = ?").get(id) as { enabled: number };
      expect(row.enabled).toBe(0);

      expect(mockIO._emitFn).toHaveBeenCalledWith(
        "scheduler:job-toggled",
        expect.objectContaining({ jobId: id, enabled: false }),
      );
    });

    it("enables a disabled job", async () => {
      const id = await scheduler.register({
        name: "re-enable",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
        enabled: false,
      });

      await scheduler.toggle(id, true);

      const row = db.prepare("SELECT enabled FROM _scheduler_jobs WHERE id = ?").get(id) as { enabled: number };
      expect(row.enabled).toBe(1);
    });

    it("throws for another extension's job", async () => {
      db.prepare(
        `INSERT INTO _scheduler_jobs
         (id, project_id, extension_name, job_name, cron_expression, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run("foreign-job", "proj-1", "other-ext", "job-1", "0 * * * *", new Date().toISOString(), new Date().toISOString());

      await expect(scheduler.toggle("foreign-job", false)).rejects.toThrow("does not own");
    });
  });

  // -----------------------------------------------------------------------
  // list()
  // -----------------------------------------------------------------------

  describe("list()", () => {
    it("returns all jobs for the extension", async () => {
      await scheduler.register({
        name: "job-a",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });
      await scheduler.register({
        name: "job-b",
        cron: "*/10 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });

      const jobs = await scheduler.list();
      expect(jobs).toHaveLength(2);
      expect(jobs.map((j) => j.name).sort()).toEqual(["job-a", "job-b"]);
    });

    it("does not include jobs from other extensions", async () => {
      await scheduler.register({
        name: "my-job",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });

      // Insert another extension's job
      db.prepare(
        `INSERT INTO _scheduler_jobs
         (id, project_id, extension_name, job_name, cron_expression, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run("other-id", "proj-1", "other-ext", "other-job", "0 * * * *", new Date().toISOString(), new Date().toISOString());

      const jobs = await scheduler.list();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.name).toBe("my-job");
    });

    it("maps fields correctly", async () => {
      const id = await scheduler.register({
        name: "full-job",
        cron: "*/5 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
        timezone: "UTC",
        description: "A test job",
      });

      const jobs = await scheduler.list();
      const job = jobs.find((j) => j.id === id);
      expect(job).toBeDefined();
      expect(job!.name).toBe("full-job");
      expect(job!.cron).toBe("*/5 * * * *");
      expect(job!.timezone).toBe("UTC");
      expect(job!.enabled).toBe(true);
      expect(job!.description).toBe("A test job");
    });

    it("returns empty array when no jobs exist", async () => {
      const jobs = await scheduler.list();
      expect(jobs).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // runs()
  // -----------------------------------------------------------------------

  describe("runs()", () => {
    it("returns run history for a job", async () => {
      const jobId = await scheduler.register({
        name: "run-test",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });

      // Insert some runs
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO _scheduler_runs
         (id, job_id, extension_name, project_id, status, started_at, completed_at, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("run-1", jobId, "test-ext", "proj-1", "completed", now, now, 100);

      db.prepare(
        `INSERT INTO _scheduler_runs
         (id, job_id, extension_name, project_id, status, started_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run("run-2", jobId, "test-ext", "proj-1", "failed", now, "boom");

      const runs = await scheduler.runs(jobId);
      expect(runs).toHaveLength(2);
      expect(runs.map((r) => r.status).sort()).toEqual(["completed", "failed"]);

      const completedRun = runs.find((r) => r.status === "completed");
      expect(completedRun!.durationMs).toBe(100);

      const failedRun = runs.find((r) => r.status === "failed");
      expect(failedRun!.error).toBe("boom");
    });

    it("respects limit parameter", async () => {
      const jobId = await scheduler.register({
        name: "limit-test",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });

      const now = new Date().toISOString();
      for (let i = 0; i < 5; i++) {
        db.prepare(
          `INSERT INTO _scheduler_runs
           (id, job_id, extension_name, project_id, status, started_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(`run-${i}`, jobId, "test-ext", "proj-1", "completed", now);
      }

      const runs = await scheduler.runs(jobId, { limit: 2 });
      expect(runs).toHaveLength(2);
    });

    it("throws for another extension's job", async () => {
      db.prepare(
        `INSERT INTO _scheduler_jobs
         (id, project_id, extension_name, job_name, cron_expression, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run("foreign-job", "proj-1", "other-ext", "job-1", "0 * * * *", new Date().toISOString(), new Date().toISOString());

      await expect(scheduler.runs("foreign-job")).rejects.toThrow("does not own");
    });
  });

  // -----------------------------------------------------------------------
  // executeJob()
  // -----------------------------------------------------------------------

  describe("executeJob()", () => {
    it("executes a job callback and records a completed run", async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      const jobId = await scheduler.register({
        name: "exec-test",
        cron: "0 * * * *",
        callback,
      });

      await scheduler.executeJob(jobId);

      expect(callback).toHaveBeenCalledTimes(1);
      const ctx = callback.mock.calls[0]![0] as CronJobContext;
      expect(ctx.jobId).toBe(jobId);
      expect(ctx.projectId).toBe("proj-1");
      expect(ctx.signal).toBeInstanceOf(AbortSignal);

      // Check run record
      const runs = db.prepare(
        "SELECT * FROM _scheduler_runs WHERE job_id = ?",
      ).all(jobId) as Array<Record<string, unknown>>;
      expect(runs).toHaveLength(1);
      expect(runs[0]!["status"]).toBe("completed");
      expect(runs[0]!["duration_ms"]).toBeGreaterThanOrEqual(0);

      // Check last_run_at updated on job
      const job = db.prepare(
        "SELECT last_run_at, last_run_status FROM _scheduler_jobs WHERE id = ?",
      ).get(jobId) as Record<string, unknown>;
      expect(job["last_run_at"]).toBeDefined();
      expect(job["last_run_status"]).toBe("completed");
    });

    it("records a failed run when callback throws", async () => {
      const callback = vi.fn().mockRejectedValue(new Error("callback error"));
      const jobId = await scheduler.register({
        name: "fail-test",
        cron: "0 * * * *",
        callback,
      });

      await scheduler.executeJob(jobId);

      const runs = db.prepare(
        "SELECT * FROM _scheduler_runs WHERE job_id = ?",
      ).all(jobId) as Array<Record<string, unknown>>;
      expect(runs).toHaveLength(1);
      expect(runs[0]!["status"]).toBe("failed");
      expect(runs[0]!["error"]).toBe("callback error");
    });

    it("times out after timeout_ms and records timed_out status", async () => {
      const callback = vi.fn().mockImplementation(async (ctx: CronJobContext) => {
        // Wait longer than the timeout
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Aborted"));
          });
        });
      });

      const jobId = await scheduler.register({
        name: "timeout-test",
        cron: "0 * * * *",
        callback,
        timeoutMs: 50, // Very short timeout
      });

      await scheduler.executeJob(jobId);

      const runs = db.prepare(
        "SELECT * FROM _scheduler_runs WHERE job_id = ?",
      ).all(jobId) as Array<Record<string, unknown>>;
      expect(runs).toHaveLength(1);
      expect(runs[0]!["status"]).toBe("timed_out");
    });

    it("skips execution when no callback is registered", async () => {
      // Insert a job directly without callback
      db.prepare(
        `INSERT INTO _scheduler_jobs
         (id, project_id, extension_name, job_name, cron_expression, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run("no-cb-job", "proj-1", "test-ext", "nocb", "0 * * * *", new Date().toISOString(), new Date().toISOString());

      await scheduler.executeJob("no-cb-job");

      const runs = db.prepare(
        "SELECT * FROM _scheduler_runs WHERE job_id = ?",
      ).all("no-cb-job") as Array<Record<string, unknown>>;
      expect(runs).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // loadAndSchedule()
  // -----------------------------------------------------------------------

  describe("loadAndSchedule()", () => {
    it("loads and schedules enabled jobs with callbacks", async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      await scheduler.register({
        name: "load-test",
        cron: "0 * * * *",
        callback,
      });

      // This should load enabled jobs from DB and re-schedule them
      scheduler.loadAndSchedule();

      // Verify the job is still listed (scheduling didn't error)
      const jobs = await scheduler.list();
      expect(jobs.some((j) => j.name === "load-test")).toBe(true);
      scheduler.stopAll();
    });

    it("does not schedule disabled jobs", async () => {
      await scheduler.register({
        name: "disabled-sched",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
        enabled: false,
      });

      scheduler.loadAndSchedule();
      // Disabled job should still be listed but not running
      const jobs = await scheduler.list();
      expect(jobs.some((j) => j.name === "disabled-sched" && !j.enabled)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // pauseAll() / stopAll()
  // -----------------------------------------------------------------------

  describe("pauseAll() and stopAll()", () => {
    it("pauseAll stops all active tasks", async () => {
      await scheduler.register({
        name: "pause-1",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });
      await scheduler.register({
        name: "pause-2",
        cron: "*/5 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });

      scheduler.pauseAll();

      // Jobs should still exist in DB
      const rows = db.prepare(
        "SELECT COUNT(*) as cnt FROM _scheduler_jobs WHERE extension_name = ?",
      ).get("test-ext") as { cnt: number };
      expect(rows.cnt).toBe(2);
    });

    it("stopAll stops tasks and clears callbacks", async () => {
      const id = await scheduler.register({
        name: "stop-test",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });

      scheduler.stopAll();

      // Executing after stopAll should not run callback (no callback registered)
      await scheduler.executeJob(id);

      const runs = db.prepare(
        "SELECT * FROM _scheduler_runs WHERE job_id = ?",
      ).all(id) as Array<Record<string, unknown>>;
      expect(runs).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Ownership checks
  // -----------------------------------------------------------------------

  describe("ownership checks", () => {
    it("cannot cancel another extension's job", async () => {
      db.prepare(
        `INSERT INTO _scheduler_jobs
         (id, project_id, extension_name, job_name, cron_expression, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run("alien-job", "proj-1", "alien-ext", "job-1", "0 * * * *", new Date().toISOString(), new Date().toISOString());

      await expect(scheduler.cancel("alien-job")).rejects.toThrow("does not own");
    });

    it("cannot toggle another extension's job", async () => {
      db.prepare(
        `INSERT INTO _scheduler_jobs
         (id, project_id, extension_name, job_name, cron_expression, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run("alien-toggle", "proj-1", "alien-ext", "job-2", "0 * * * *", new Date().toISOString(), new Date().toISOString());

      await expect(scheduler.toggle("alien-toggle", false)).rejects.toThrow("does not own");
    });

    it("cannot read runs of another extension's job", async () => {
      db.prepare(
        `INSERT INTO _scheduler_jobs
         (id, project_id, extension_name, job_name, cron_expression, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run("alien-runs", "proj-1", "alien-ext", "job-3", "0 * * * *", new Date().toISOString(), new Date().toISOString());

      await expect(scheduler.runs("alien-runs")).rejects.toThrow("does not own");
    });
  });

  // -----------------------------------------------------------------------
  // Concurrency limits
  // -----------------------------------------------------------------------

  describe("concurrency limits", () => {
    it("skips execution when per-extension concurrent limit (2) is reached", async () => {
      // Create a job whose callback blocks until we resolve
      let resolveBlock1!: () => void;
      let resolveBlock2!: () => void;
      const block1 = new Promise<void>((r) => { resolveBlock1 = r; });
      const block2 = new Promise<void>((r) => { resolveBlock2 = r; });
      const cb3 = vi.fn().mockResolvedValue(undefined);

      const id1 = await scheduler.register({
        name: "concurrent-1",
        cron: "0 * * * *",
        callback: vi.fn().mockReturnValue(block1),
      });
      const id2 = await scheduler.register({
        name: "concurrent-2",
        cron: "0 * * * *",
        callback: vi.fn().mockReturnValue(block2),
      });
      const id3 = await scheduler.register({
        name: "concurrent-3",
        cron: "0 * * * *",
        callback: cb3,
      });

      // Start two jobs — they will be "running" (pending promises)
      const exec1 = scheduler.executeJob(id1);
      const exec2 = scheduler.executeJob(id2);

      // Third should be skipped due to per-extension limit
      await scheduler.executeJob(id3);
      expect(cb3).not.toHaveBeenCalled();

      // Clean up
      resolveBlock1();
      resolveBlock2();
      await exec1;
      await exec2;
    });
  });

  // -----------------------------------------------------------------------
  // estimateMinIntervalMinutes (tested via register)
  // -----------------------------------------------------------------------

  describe("cron interval validation", () => {
    it("allows */1 minute cron (min interval is 1)", async () => {
      // */1 means every minute, which equals minIntervalMinutes (1)
      const id = await scheduler.register({
        name: "every-minute",
        cron: "* * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });
      expect(id).toBeDefined();
    });

    it("allows comma-separated minute list with gap >= 1", async () => {
      const id = await scheduler.register({
        name: "comma-job",
        cron: "0,30 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });
      expect(id).toBeDefined();
    });

    it("allows once-per-hour cron", async () => {
      const id = await scheduler.register({
        name: "hourly-job",
        cron: "15 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });
      expect(id).toBeDefined();
    });

    it("allows once-per-day cron", async () => {
      const id = await scheduler.register({
        name: "daily-job",
        cron: "0 9 * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });
      expect(id).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // list() includes nextRunAt from computeNextRunAt
  // -----------------------------------------------------------------------

  describe("list() with nextRunAt", () => {
    it("includes nextRunAt for step-based cron expressions", async () => {
      await scheduler.register({
        name: "step-job",
        cron: "*/5 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });

      const jobs = await scheduler.list();
      const job = jobs.find((j) => j.name === "step-job");
      expect(job).toBeDefined();
      // nextRunAt should be a valid ISO string
      expect(job!.nextRunAt).toBeDefined();
      expect(new Date(job!.nextRunAt!).getTime()).toBeGreaterThan(0);
    });

    it("includes nextRunAt for every-minute cron", async () => {
      await scheduler.register({
        name: "minute-job",
        cron: "* * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });

      const jobs = await scheduler.list();
      const job = jobs.find((j) => j.name === "minute-job");
      expect(job!.nextRunAt).toBeDefined();
    });

    it("includes nextRunAt for fixed-minute cron", async () => {
      await scheduler.register({
        name: "fixed-min-job",
        cron: "30 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });

      const jobs = await scheduler.list();
      const job = jobs.find((j) => j.name === "fixed-min-job");
      expect(job!.nextRunAt).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // executeJob edge cases
  // -----------------------------------------------------------------------

  describe("executeJob() edge cases", () => {
    it("does nothing for a non-existent job ID", async () => {
      // Should not throw
      await scheduler.executeJob("non-existent-id");
    });

    it("emits scheduler:run-completed event on success", async () => {
      const jobId = await scheduler.register({
        name: "emit-test",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });

      await scheduler.executeJob(jobId);

      expect(mockIO._emitFn).toHaveBeenCalledWith(
        "scheduler:run-completed",
        expect.objectContaining({
          jobId,
          status: "completed",
        }),
      );
    });

    it("emits scheduler:run-completed event on failure", async () => {
      const jobId = await scheduler.register({
        name: "fail-emit-test",
        cron: "0 * * * *",
        callback: vi.fn().mockRejectedValue(new Error("oops")),
      });

      await scheduler.executeJob(jobId);

      expect(mockIO._emitFn).toHaveBeenCalledWith(
        "scheduler:run-completed",
        expect.objectContaining({
          jobId,
          status: "failed",
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Socket.IO emission error resilience
  // -----------------------------------------------------------------------

  describe("emitEvent error resilience", () => {
    it("does not throw when Socket.IO emit throws", async () => {
      const brokenIO = createMockIO();
      brokenIO._toFn.mockImplementation(() => {
        throw new Error("Socket.IO is broken");
      });

      const brokenScheduler = makeScheduler(db, brokenIO);

      // register calls emitEvent — should not throw
      const id = await brokenScheduler.register({
        name: "broken-io-job",
        cron: "0 * * * *",
        callback: vi.fn().mockResolvedValue(undefined),
      });
      expect(id).toBeDefined();

      brokenScheduler.stopAll();
    });
  });
});
