# Phase 5 — Automation REST API & Socket.IO Events

## Goal

Expose AutomationEngine functionality via REST routes, implement Socket.IO `automation:{runId}` room handling, wire AutomationEngine into the worker service lifecycle, and implement log retention cleanup.

## Reference

- ADR-050: Automations (§8, §9, §14)
- ADR-048: Socket.IO Real-Time Communication (automation room amendment)

## Dependencies

- Phase 3 (AutomationEngine Core) — data model, CRUD, scheduling
- Phase 4 (Chain Executor) — execution pipeline must be in place for trigger/cancel

## Tasks

### 5.1 REST Routes: Automation CRUD & Execution

File: `packages/worker-service/src/routes/automations.ts`

- [ ] Create Express Router with project-scoped routes

- [ ] `GET /api/:pid/automations` — List automations for project
  - Call `automationEngine.listAutomations(projectId)`
  - Include last run summary for each automation via SQL join:
    ```sql
    SELECT a.*, r.status AS last_run_status, r.started_at AS last_run_at, r.duration_ms AS last_run_duration
    FROM _automations a
    LEFT JOIN _automation_runs r ON r.automation_id = a.id
      AND r.started_at = (SELECT MAX(started_at) FROM _automation_runs WHERE automation_id = a.id)
    WHERE a.project_id = ?
    ```
  - If no run exists: `lastRun: null`
  - Return `200` with `Automation[]` (each with optional `lastRun: { status, startedAt, durationMs }`)
  - Running automations appear in list with status `running`

- [ ] `POST /api/:pid/automations` — Create automation
  - Body: `CreateAutomationInput`
  - Validate required fields: `name`, `schedule`, `chain` (at least 1 step)
  - Validate each step has: `name`, `prompt`, `model`, `tools`, `onError`
  - Validate cron expression if `schedule.type === "cron"`
  - Call `automationEngine.createAutomation(projectId, input)`
  - Return `201` with created `Automation`
  - Return `400` for validation errors

- [ ] `GET /api/:pid/automations/models` — List available models
  - Proxy to `copilotBridge.listModels()`
  - Return `200` with model list
  - Return `503` if CopilotBridge is unavailable

- [ ] `GET /api/:pid/automations/:id` — Get automation details
  - Call `automationEngine.getAutomation(id)`
  - Return `200` with `Automation`
  - Return `404` if not found

- [ ] `PUT /api/:pid/automations/:id` — Update automation
  - Body: `UpdateAutomationInput`
  - Validate same constraints as create
  - Call `automationEngine.updateAutomation(id, updates)`
  - Return `200` with updated `Automation`

- [ ] `DELETE /api/:pid/automations/:id` — Delete automation
  - Call `automationEngine.deleteAutomation(id)`
  - Return `204`
  - Return `404` if not found

- [ ] `POST /api/:pid/automations/:id/toggle` — Enable/disable automation
  - Body: `{ enabled: boolean }`
  - Call `automationEngine.toggleAutomation(id, enabled)`
  - Return `200` with `{ enabled }`

- [ ] `POST /api/:pid/automations/:id/trigger` — Manually trigger a run
  - Call `automationEngine.triggerRun(id)`
  - Return `202` with `{ runId }`
  - Return `409` if another run is active (concurrency guard)

- [ ] `GET /api/:pid/automations/:id/runs` — List run history
  - Query params: `limit`, `status` (optional filter)
  - Call `automationEngine.listRuns(id, opts)`
  - Return `200` with `AutomationRun[]`

- [ ] `GET /api/:pid/automations/:id/runs/:runId` — Get run details
  - Call `automationEngine.getRunDetails(runId)`
  - Return `200` with full `AutomationRun` including step logs and tool calls
  - Return `404` if not found

- [ ] `POST /api/:pid/automations/:id/runs/:runId/cancel` — Cancel running automation
  - Call `automationEngine.cancelRun(runId)`
  - Return `200` with `{ status: "cancelled" }`
  - Return `404` if run not found
  - Return `409` if run is not in `running` status

### 5.2 Socket.IO: `automation:{runId}` Room

File: `packages/worker-service/src/core/socket-bridge.ts` (amend existing)

- [ ] Add `automation:join` client event handler (ADR-048 amendment):
  - Client emits `automation:join { runId }`
  - Server joins the socket to `automation:{runId}` room
  - Follow same pattern as `project:join` / `chat:join`

- [ ] Add `automation:leave` client event handler:
  - Client emits `automation:leave { runId }`
  - Server leaves the socket from `automation:{runId}` room

- [ ] Register event forwarding from AutomationEngine to Socket.IO rooms:
  - **Project-level events** (to `project:{projectId}` room):
    - `automation:run-started` — `{ automationId, runId, automationName, trigger, worktreePath? }`
    - `automation:run-completed` — `{ automationId, runId, status, durationMs }`
    - `automation:run-failed` — `{ automationId, runId, error }`
  - **Run-level events** (to `automation:{runId}` room):
    - `automation:step-started` — `{ stepId, stepIndex, stepName, model }`
    - `automation:step-completed` — `{ stepId, stepIndex, status, durationMs, outputPreview }`
    - `automation:step-failed` — `{ stepId, stepIndex, error }`
    - `automation:tool-called` — `{ stepId, toolName, source, durationMs, success, autoApproved? }`
    - `automation:message-delta` — `{ stepId, deltaContent }`
    - `automation:log` — `{ level, message, timestamp }`

### 5.3 Log Retention & Cleanup

File: `packages/worker-service/src/core/automation-engine.ts`

- [ ] Implement `runLogCleanup(): Promise<void>` (ADR-050 §14):
  - **Run records**: delete runs older than `retentionDays` (default 90 days)
    ```sql
    DELETE FROM _automation_runs
    WHERE created_at < datetime('now', '-' || ? || ' days')
    ```
    (Cascades to step logs and tool calls via foreign keys)
  - **Response truncation**: truncate `response` in `_automation_step_logs` older than `responseRetentionDays` (default 30 days) to first 500 characters
    ```sql
    UPDATE _automation_step_logs
    SET response = substr(response, 1, 500) || '... [truncated]'
    WHERE run_id IN (
      SELECT id FROM _automation_runs
      WHERE created_at < datetime('now', '-' || ? || ' days')
    ) AND length(response) > 500
    ```

- [ ] Schedule log cleanup to run daily:
  - Register a daily `setInterval` (24h) in `AutomationEngine.start()` that calls `runLogCleanup()`
  - If `auto-purge-scheduler.ts` exists, register cleanup as a callback; otherwise use standalone timer
  - Also clean up extension cron run history: `DELETE FROM _scheduler_runs WHERE created_at < datetime('now', '-90 days')`

### 5.4 Wire AutomationEngine into App Lifecycle

File: `packages/worker-service/src/app.ts` (amend existing)

- [ ] Instantiate `AutomationEngine` with `db`, `copilotBridge`, `worktreeManager`, `io`
- [ ] Call `automationEngine.start()` during server startup (after WorktreeManager is started)
- [ ] Call `automationEngine.stop()` during graceful shutdown (before WorktreeManager stops)
- [ ] Register automation routes:
  ```typescript
  app.use("/api/:pid/automations", automationRoutes(automationEngine));
  ```
- [ ] Export `automationEngine` instance for access by ExtensionScheduler (Phase 6)

### 5.5 Tests

File: `packages/worker-service/src/routes/automations.test.ts`

- [ ] Test `GET /api/:pid/automations` returns automation list
- [ ] Test `POST /api/:pid/automations` creates automation
- [ ] Test `POST /api/:pid/automations` validates chain (at least 1 step)
- [ ] Test `POST /api/:pid/automations` validates cron expression
- [ ] Test `POST /api/:pid/automations` returns 400 for invalid input
- [ ] Test `GET /api/:pid/automations/models` returns model list
- [ ] Test `GET /api/:pid/automations/:id` returns automation details
- [ ] Test `PUT /api/:pid/automations/:id` updates automation
- [ ] Test `DELETE /api/:pid/automations/:id` deletes automation
- [ ] Test `POST /api/:pid/automations/:id/toggle` enables/disables
- [ ] Test `POST /api/:pid/automations/:id/trigger` triggers run
- [ ] Test `POST /api/:pid/automations/:id/trigger` returns 409 if run active
- [ ] Test `GET /api/:pid/automations/:id/runs` returns run history
- [ ] Test `GET /api/:pid/automations/:id/runs/:runId` returns run details with steps/tools
- [ ] Test `POST /api/:pid/automations/:id/runs/:runId/cancel` cancels running run
- [ ] Test log cleanup: old runs deleted, responses truncated

## Verification

```bash
pnpm run lint
pnpm run lint:duplication
pnpm --filter @renre-kit/worker-service test -- --run automations
pnpm run build
```
