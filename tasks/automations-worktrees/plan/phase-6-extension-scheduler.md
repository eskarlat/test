# Phase 6 — Extension Scheduler

## Goal

Implement the extension-scoped cron scheduler: `ScopedScheduler` proxy, SDK types, `scheduler` permission, SQL schema, frequency/concurrency limits, extension lifecycle integration, REST routes for Console UI visibility, and `ScopedDatabase` amendments to block automation tables.

## Reference

- ADR-050: Automations (§16 — all subsections 16.1 through 16.10)
- ADR-017: Extension Permissions (scheduler permission amendment)
- ADR-019: Extension SDK Contract (ScopedScheduler in ExtensionContext, ScopedDatabase blocked tables amendment)

## Dependencies

- Phase 3 (AutomationEngine Core) — `node-cron` dependency, DB instance, AutomationEngine for startup scheduling

## Tasks

### 6.1 SQL Migration: Extension Scheduler Tables

File: `packages/worker-service/migrations/0XX_scheduler.up.sql` (next available number)

- [ ] Create `_scheduler_jobs` table (ADR-050 §16.4):
  ```sql
  CREATE TABLE _scheduler_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    extension_name TEXT NOT NULL,
    job_name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    timezone TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    timeout_ms INTEGER DEFAULT 60000,
    last_run_at TEXT,
    last_run_status TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(project_id, extension_name, job_name)
  );
  ```
- [ ] Create indexes: `idx_scheduler_project_ext`, `idx_scheduler_enabled`

- [ ] Create `_scheduler_runs` table (ADR-050 §16.4):
  - All columns including `status` CHECK: `running`, `completed`, `failed`, `timed_out`
  - Foreign key to `_scheduler_jobs(id)` with `ON DELETE CASCADE`
- [ ] Create indexes: `idx_scheduler_runs_job`, `idx_scheduler_runs_ext`

- [ ] Create corresponding down migration

### 6.2 Extension SDK: ScopedScheduler Types

File: `packages/extension-sdk/src/types/scheduler.ts` (new file)

- [ ] Export `ScopedScheduler` interface (ADR-050 §16.2):
  - `register(opts: CronJobOptions): Promise<string>`
  - `cancel(jobId: string): Promise<void>`
  - `toggle(jobId: string, enabled: boolean): Promise<void>`
  - `list(): Promise<CronJobInfo[]>`
  - `runs(jobId: string, opts?: { limit?: number }): Promise<CronJobRun[]>`

- [ ] Export `CronJobOptions` interface:
  - `name`, `cron`, `timezone?`, `callback`, `timeoutMs?`, `enabled?`, `description?`

- [ ] Export `CronJobContext` interface:
  - `jobId`, `projectId`, `db`, `logger`, `config`, `mcp`, `signal`

- [ ] Export `CronJobInfo` interface:
  - `id`, `name`, `cron`, `timezone?`, `enabled`, `description?`, `lastRunAt?`, `lastRunStatus?`, `nextRunAt?`

- [ ] Export `CronJobRun` interface:
  - `id`, `jobId`, `status` (4 values: `running`, `completed`, `failed`, `timed_out`), `startedAt`, `completedAt?`, `durationMs?`, `error?`

File: `packages/extension-sdk/src/types/index.ts` (amend)

- [ ] Re-export all scheduler types
- [ ] Update `ExtensionContext` interface to add `scheduler: ScopedScheduler | null`

### 6.3 ScopedScheduler Implementation

File: `packages/worker-service/src/core/scoped-scheduler.ts`

- [ ] Export `ScopedScheduler` class that enforces isolation (ADR-050 §16.3):

  Constructor: `(db, io, extensionName, projectId, extensionContext)`

- [ ] Implement `register(opts: CronJobOptions): Promise<string>`:
  1. Validate cron expression via `node-cron.validate()`
  2. Check minimum interval against `config.minIntervalMinutes`
  3. Check max jobs per extension per project against `config.maxJobsPerExtension`
  4. Internal name: `{extensionName}:{opts.name}` — ensures uniqueness across extensions
  5. Insert into `_scheduler_jobs` with `extension_name` column
  6. Create `cron.schedule()` with the expression
  7. Store callback reference for execution
  8. Return job ID

- [ ] Implement `cancel(jobId: string): Promise<void>`:
  - Query job, verify `extension_name` matches this instance's extension
  - If not owned: throw `JobNotFoundError` (extension cannot confirm job exists)
  - Stop cron task, delete from `_scheduler_jobs` (cascades to `_scheduler_runs`)

- [ ] Implement `toggle(jobId: string, enabled: boolean): Promise<void>`:
  - Ownership check (same as cancel)
  - Update `enabled` column
  - Start/stop cron task accordingly

- [ ] Implement `list(): Promise<CronJobInfo[]>`:
  - Query `_scheduler_jobs WHERE extension_name = ? AND project_id = ?`
  - Map to `CronJobInfo` interface (compute `nextRunAt` from cron expression)

- [ ] Implement `runs(jobId: string, opts?): Promise<CronJobRun[]>`:
  - Ownership check
  - Query `_scheduler_runs` for the job, ordered by `started_at DESC`, with optional limit

- [ ] Implement `private executeJob(job, callback)`:
  1. Check concurrency limit: count running executions for this extension
  2. If at limit: skip execution, log warning
  3. Create `_scheduler_runs` record with status `running`
  4. Build `CronJobContext`: `{ jobId, projectId, db, logger, config, mcp, signal }`
  5. Execute callback inside `try/catch` + timeout (AbortController)
  6. On success: update run `completed`, `durationMs`
  7. On error: update run `failed`, record error
  8. On timeout: update run `timed_out`
  9. Update `_scheduler_jobs.last_run_at` and `last_run_status`
  10. **Circuit breaker** (ADR-050 §16.3 point 4): errors count toward separate counter from route handler failures

- [ ] Implement `loadAndSchedule()`:
  - Query all enabled jobs for this extension and project
  - Create cron tasks for each
  - Called at extension mount time

- [ ] Implement `pauseAll()` / `stopAll()`:
  - Pause all cron tasks for this extension
  - Cancel active executions via AbortSignal
  - Called at extension unmount/suspend

### 6.4 Frequency & Concurrency Limits

File: `packages/worker-service/src/core/scoped-scheduler.ts`

- [ ] Define limit defaults (ADR-050 §16.6):
  ```typescript
  const SCHEDULER_LIMITS = {
    maxJobsPerExtension: 10,
    minIntervalMinutes: 1,
    maxConcurrentPerExtension: 2,
    maxConcurrentTotal: 10,
  };
  ```
- [ ] Read overrides from `~/.renre-kit/config.json` → `scheduler` key
- [ ] Enforce `maxJobsPerExtension` in `register()`
- [ ] Enforce `minIntervalMinutes` in `register()` — parse cron, check minimum interval
- [ ] Enforce `maxConcurrentPerExtension` in `executeJob()` — check running count
- [ ] Enforce `maxConcurrentTotal` in `executeJob()` — check all extensions' running count

### 6.5 ScopedDatabase Amendment: Block Automation Tables

File: `packages/worker-service/src/core/scoped-database.ts` (amend existing)

- [ ] Add to the blocked table list (ADR-019 amendment from ADR-050 §16.3):
  - `_scheduler_jobs`
  - `_scheduler_runs`
  - `_automations`
  - `_automation_runs`
  - `_automation_step_logs`
  - `_automation_tool_calls`
- [ ] Verify the blocking pattern catches both direct table references and `_` prefix pattern

### 6.6 Extension Permission: `scheduler`

File: `packages/worker-service/src/core/manifest-validator.ts` (amend)

- [ ] Add `scheduler` to valid permission types (ADR-017 amendment from ADR-050 §16.5)
- [ ] `scheduler: true` is a boolean permission (same pattern as `database`)

File: `packages/worker-service/src/core/extension-loader.ts` (amend)

- [ ] When building `ExtensionContext`:
  - If extension has `scheduler: true` permission → create `ScopedScheduler` instance
  - If not → set `scheduler: null`
- [ ] On extension mount: call `scopedScheduler.loadAndSchedule()`
- [ ] On extension unmount: call `scopedScheduler.pauseAll()`

### 6.7 Extension Lifecycle Integration

File: `packages/worker-service/src/core/scoped-scheduler.ts` and `extension-loader.ts`

- [ ] Implement lifecycle events (ADR-050 §16.7):
  - **Mount**: `ScopedScheduler` created, existing jobs loaded and scheduled
  - **Unmount**: all cron jobs paused (not deleted), active executions receive AbortSignal
  - **Uninstall**: all cron jobs and run history deleted (`DELETE FROM _scheduler_jobs WHERE extension_name = ?`)
  - **Suspend (circuit breaker)**: all cron jobs paused, re-enabled when circuit breaker resets
  - **Worker shutdown**: all extension cron jobs stopped cleanly
  - **Worker startup**: all enabled extension cron jobs for active projects re-scheduled

- [ ] Permission upgrade/downgrade handling (ADR-050 §16.5):
  - If extension upgrades and **removes** `scheduler` permission: pause all existing jobs (`enabled = false`), show notification in Console UI
  - If extension re-adds permission: re-enable paused jobs

### 6.8 REST Routes: Extension Cron (Read-Only + Toggle)

File: `packages/worker-service/src/routes/ext-cron.ts`

- [ ] `GET /api/:pid/ext-cron` — List all extension cron jobs for project (ADR-050 §16.10)
  - Query `_scheduler_jobs WHERE project_id = ?`
  - Group by `extension_name`
  - Include last run info and computed `nextRunAt`
  - Return `200` with grouped job list

- [ ] `POST /api/:pid/ext-cron/:jobId/toggle` — Pause/resume an extension cron job
  - Body: `{ enabled: boolean }`
  - Update `_scheduler_jobs.enabled`
  - Start/stop corresponding cron task
  - Return `200` with updated job info

- [ ] `GET /api/:pid/ext-cron/:jobId/runs` — Get run history for extension cron job
  - Query params: `limit` (default 20)
  - Query `_scheduler_runs WHERE job_id = ?` ordered by `started_at DESC`
  - Return `200` with `CronJobRun[]`

- [ ] No create/update/delete endpoints — extension cron jobs are managed programmatically

### 6.9 Wire into App Lifecycle

File: `packages/worker-service/src/app.ts` (amend)

- [ ] Register ext-cron routes:
  ```typescript
  app.use("/api/:pid/ext-cron", extCronRoutes(db));
  ```
- [ ] Ensure `AutomationEngine.start()` re-schedules extension cron jobs (update stub from Phase 3)

### 6.10 Tests

File: `packages/worker-service/src/core/scoped-scheduler.test.ts`

- [ ] Test `register()`: creates job, validates cron
- [ ] Test `register()`: enforces max jobs per extension limit
- [ ] Test `register()`: rejects intervals below minimum
- [ ] Test `cancel()`: only cancels own jobs
- [ ] Test `cancel()`: throws JobNotFoundError for other extension's jobs
- [ ] Test `toggle()`: enables/disables cron task
- [ ] Test `list()`: returns only this extension's jobs
- [ ] Test `runs()`: returns run history for owned job
- [ ] Test `executeJob()`: respects concurrency limits
- [ ] Test `executeJob()`: timeout aborts via signal
- [ ] Test `executeJob()`: errors logged, circuit breaker counted
- [ ] Test `loadAndSchedule()`: re-creates cron tasks for existing jobs
- [ ] Test `pauseAll()`: stops all tasks, signals active executions

File: `packages/worker-service/src/core/scoped-database.test.ts` (amend)

- [ ] Test that `_scheduler_jobs`, `_scheduler_runs`, `_automations`, `_automation_runs`, `_automation_step_logs`, `_automation_tool_calls` are blocked

File: `packages/worker-service/src/routes/ext-cron.test.ts`

- [ ] Test `GET /api/:pid/ext-cron` returns grouped job list
- [ ] Test `POST /api/:pid/ext-cron/:jobId/toggle` toggles job
- [ ] Test `GET /api/:pid/ext-cron/:jobId/runs` returns run history

## Verification

```bash
pnpm run lint
pnpm run lint:duplication
pnpm --filter @renre-kit/worker-service test -- --run scoped-scheduler scoped-database ext-cron
pnpm --filter @renre-kit/extension-sdk test
pnpm run build
```
