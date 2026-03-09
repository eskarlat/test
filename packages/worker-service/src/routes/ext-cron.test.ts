import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Mock logger before importing the route module
vi.mock("../core/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import extCronRouter, { setExtCronDb } from "./ext-cron.js";

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

function createApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use(extCronRouter);
  return app;
}

function insertJob(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    project_id: string;
    extension_name: string;
    job_name: string;
    cron_expression: string;
    timezone: string | null;
    enabled: number;
    description: string | null;
    timeout_ms: number;
    last_run_at: string | null;
    last_run_status: string | null;
  }> = {},
): void {
  const defaults = {
    id: "job-1",
    project_id: "proj-1",
    extension_name: "test-ext",
    job_name: "test-job",
    cron_expression: "*/5 * * * *",
    timezone: null,
    enabled: 1,
    description: null,
    timeout_ms: 60000,
    last_run_at: null,
    last_run_status: null,
  };
  const row = { ...defaults, ...overrides };
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO _scheduler_jobs
     (id, project_id, extension_name, job_name, cron_expression, timezone,
      enabled, description, timeout_ms, last_run_at, last_run_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.project_id, row.extension_name, row.job_name, row.cron_expression,
    row.timezone, row.enabled, row.description, row.timeout_ms,
    row.last_run_at, row.last_run_status, now, now,
  );
}

function insertRun(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    job_id: string;
    extension_name: string;
    project_id: string;
    status: string;
    started_at: string;
    completed_at: string | null;
    duration_ms: number | null;
    error: string | null;
  }> = {},
): void {
  const now = new Date().toISOString();
  const defaults = {
    id: "run-1",
    job_id: "job-1",
    extension_name: "test-ext",
    project_id: "proj-1",
    status: "completed",
    started_at: now,
    completed_at: now,
    duration_ms: 100,
    error: null,
  };
  const row = { ...defaults, ...overrides };
  db.prepare(
    `INSERT INTO _scheduler_runs
     (id, job_id, extension_name, project_id, status, started_at, completed_at, duration_ms, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.job_id, row.extension_name, row.project_id,
    row.status, row.started_at, row.completed_at, row.duration_ms, row.error,
  );
}

async function request(
  app: express.Application,
  method: "GET" | "POST",
  url: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const server = createServer(app);
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("no address"));
        return;
      }
      resolve(addr.port);
    });
  });
  const fetchOpts: RequestInit = { method };
  if (body) {
    fetchOpts.headers = { "Content-Type": "application/json" };
    fetchOpts.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(`http://localhost:${port}${url}`, fetchOpts);
    const json = await res.json().catch(() => null);
    server.close();
    return { status: res.status, body: json };
  } catch (err) {
    server.close();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ext-cron routes", () => {
  let db: Database.Database;
  let app: express.Application;

  beforeEach(() => {
    db = createTestDb();
    setExtCronDb(db);
    app = createApp();
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // GET /api/:pid/ext-cron
  // -----------------------------------------------------------------------

  describe("GET /api/:pid/ext-cron", () => {
    it("returns empty array when no jobs exist", async () => {
      const res = await request(app, "GET", "/api/proj-1/ext-cron");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns all jobs for the project", async () => {
      insertJob(db, { id: "job-1", extension_name: "ext-a", job_name: "job-a" });
      insertJob(db, { id: "job-2", extension_name: "ext-b", job_name: "job-b" });

      const res = await request(app, "GET", "/api/proj-1/ext-cron");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(2);
    });

    it("does not return jobs from other projects", async () => {
      insertJob(db, { id: "job-1", project_id: "proj-1" });
      insertJob(db, { id: "job-2", project_id: "proj-2" });

      const res = await request(app, "GET", "/api/proj-1/ext-cron");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
    });

    it("maps fields correctly", async () => {
      insertJob(db, {
        id: "job-full",
        extension_name: "my-ext",
        job_name: "my-job",
        cron_expression: "*/10 * * * *",
        timezone: "UTC",
        enabled: 1,
        description: "A test job",
        timeout_ms: 30000,
        last_run_at: "2025-01-01T00:00:00.000Z",
        last_run_status: "completed",
      });

      const res = await request(app, "GET", "/api/proj-1/ext-cron");
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      const job = body[0]!;
      expect(job["id"]).toBe("job-full");
      expect(job["extensionName"]).toBe("my-ext");
      expect(job["name"]).toBe("my-job");
      expect(job["cron"]).toBe("*/10 * * * *");
      expect(job["timezone"]).toBe("UTC");
      expect(job["enabled"]).toBe(true);
      expect(job["description"]).toBe("A test job");
      expect(job["timeoutMs"]).toBe(30000);
      expect(job["lastRunAt"]).toBe("2025-01-01T00:00:00.000Z");
      expect(job["lastRunStatus"]).toBe("completed");
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/:pid/ext-cron/:jobId/toggle
  // -----------------------------------------------------------------------

  describe("POST /api/:pid/ext-cron/:jobId/toggle", () => {
    it("toggles a job to disabled", async () => {
      insertJob(db, { id: "job-toggle", enabled: 1 });

      const res = await request(app, "POST", "/api/proj-1/ext-cron/job-toggle/toggle", {
        enabled: false,
      });
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["enabled"]).toBe(false);

      const row = db.prepare("SELECT enabled FROM _scheduler_jobs WHERE id = ?").get("job-toggle") as { enabled: number };
      expect(row.enabled).toBe(0);
    });

    it("toggles a job to enabled", async () => {
      insertJob(db, { id: "job-enable", enabled: 0 });

      const res = await request(app, "POST", "/api/proj-1/ext-cron/job-enable/toggle", {
        enabled: true,
      });
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["enabled"]).toBe(true);
    });

    it("returns 400 when enabled is missing", async () => {
      insertJob(db);

      const res = await request(app, "POST", "/api/proj-1/ext-cron/job-1/toggle", {});
      expect(res.status).toBe(400);
      const body = res.body as Record<string, unknown>;
      expect(body["error"]).toContain("enabled");
    });

    it("returns 404 for non-existent job", async () => {
      const res = await request(app, "POST", "/api/proj-1/ext-cron/nonexistent/toggle", {
        enabled: false,
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for job from another project", async () => {
      insertJob(db, { id: "other-proj-job", project_id: "proj-2" });

      const res = await request(app, "POST", "/api/proj-1/ext-cron/other-proj-job/toggle", {
        enabled: false,
      });
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/:pid/ext-cron/:jobId/runs
  // -----------------------------------------------------------------------

  describe("GET /api/:pid/ext-cron/:jobId/runs", () => {
    it("returns runs for a job", async () => {
      insertJob(db, { id: "job-runs" });
      insertRun(db, { id: "run-1", job_id: "job-runs", status: "completed" });
      insertRun(db, { id: "run-2", job_id: "job-runs", status: "failed", error: "boom" });

      const res = await request(app, "GET", "/api/proj-1/ext-cron/job-runs/runs");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(2);
    });

    it("returns 404 for non-existent job", async () => {
      const res = await request(app, "GET", "/api/proj-1/ext-cron/nonexistent/runs");
      expect(res.status).toBe(404);
    });

    it("returns empty array when no runs exist", async () => {
      insertJob(db, { id: "no-runs" });

      const res = await request(app, "GET", "/api/proj-1/ext-cron/no-runs/runs");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("maps run fields correctly", async () => {
      insertJob(db, { id: "job-detail" });
      const now = new Date().toISOString();
      insertRun(db, {
        id: "run-detail",
        job_id: "job-detail",
        status: "completed",
        started_at: now,
        completed_at: now,
        duration_ms: 250,
      });

      const res = await request(app, "GET", "/api/proj-1/ext-cron/job-detail/runs");
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      const run = body[0]!;
      expect(run["id"]).toBe("run-detail");
      expect(run["jobId"]).toBe("job-detail");
      expect(run["status"]).toBe("completed");
      expect(run["durationMs"]).toBe(250);
    });
  });
});
