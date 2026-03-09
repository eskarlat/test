# Phase 3 — AutomationEngine Core — Data Model & Scheduling

## Goal

Implement the AutomationEngine core: SQL schema for all 4 automation tables, TypeScript data model, template engine with single-pass substitution, CRUD operations, cron scheduling via `node-cron`, one-time scheduling, startup reconciliation, and concurrency guard.

## Reference

- ADR-050: Automations (§2-4, §6, §11, §14, §15)

## Dependencies

None — standalone worker-service module. Chain execution (Phase 4) and routes (Phase 5) build on this.

## Tasks

### 3.1 Add `node-cron` Dependency

- [ ] Add `node-cron` to `packages/worker-service/package.json`
- [ ] Add `@types/node-cron` to devDependencies
- [ ] Run `pnpm install`

### 3.2 SQL Migrations: Automation Tables

File: `packages/worker-service/migrations/0XX_automations.up.sql` (next available number)

- [ ] Create `_automations` table (ADR-050 §3):
  ```sql
  CREATE TABLE _automations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    schedule_type TEXT NOT NULL CHECK (schedule_type IN ('cron', 'once', 'manual')),
    schedule_cron TEXT,
    schedule_timezone TEXT,
    schedule_run_at TEXT,
    schedule_starts_at TEXT,
    schedule_ends_at TEXT,
    chain_json TEXT NOT NULL,
    system_prompt TEXT,
    variables_json TEXT,
    worktree_json TEXT,
    max_duration_ms INTEGER DEFAULT 300000,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  ```
- [ ] Create `_automations` indexes: `idx_automations_project`, `idx_automations_enabled`

- [ ] Create `_automation_runs` table (ADR-050 §3):
  - All columns including `status` CHECK with 7 values: `pending`, `running`, `completed`, `completed_with_warnings`, `failed`, `cancelled`, `timed_out`
  - `trigger_type` CHECK: `scheduled`, `manual`
- [ ] Create `_automation_runs` indexes: `idx_runs_automation`, `idx_runs_project_status`, `idx_runs_started`

- [ ] Create `_automation_step_logs` table (ADR-050 §3):
  - All columns including `step_index`, `resolved_prompt`, `system_prompt`, `model`, `reasoning_effort`, `input_tokens`, `output_tokens`, `response`
  - `status` CHECK: `pending`, `running`, `completed`, `failed`, `skipped`
  - Foreign key to `_automation_runs(id)` with `ON DELETE CASCADE`
- [ ] Create `_automation_step_logs` index: `idx_step_logs_run`

- [ ] Create `_automation_tool_calls` table (ADR-050 §3):
  - Integer autoincrement primary key
  - `auto_approved INTEGER DEFAULT 0` column
  - `source` CHECK: `built-in`, `extension`, `mcp`
  - Foreign key to `_automation_step_logs(id)` with `ON DELETE CASCADE`
- [ ] Create `_automation_tool_calls` index: `idx_tool_calls_step`

- [ ] Create corresponding down migration

### 3.3 Automation Data Types

File: `packages/worker-service/src/core/automation-engine.ts` (types section at top)

- [ ] Define `Automation` interface matching ADR-050 §2.1:
  - `id`, `projectId`, `name`, `description?`, `enabled`, `schedule`, `chain`, `systemPrompt?`, `variables?`, `worktree?`, `maxDurationMs?`, `createdAt`, `updatedAt`
- [ ] Define `AutomationSchedule` interface: `type`, `cron?`, `timezone?`, `runAt?`, `startsAt?`, `endsAt?`
- [ ] Define `PromptStep` interface: `id`, `name`, `prompt`, `model`, `reasoningEffort?`, `tools`, `maxTokens?`, `timeoutMs?`, `onError`, `retryCount?`, `outputFormat?`
- [ ] Define `ToolAccess` interface: `builtIn`, `extensions`, `mcp`
- [ ] Define `WorktreeConfig` interface: `enabled`, `branch?`, `cleanup`, `ttlMs?`
- [ ] Define `AutomationRun` interface matching ADR-050 §2.2:
  - All fields including `status` with 7 values, `worktree?: WorktreeRunInfo`
- [ ] Define `WorktreeRunInfo` interface: `worktreeId`, `path`, `branch`, `status`
- [ ] Define `StepExecution` interface: all debug fields including `resolvedPrompt`, `systemPrompt`, `model`, `reasoningEffort`, `inputTokens`, `outputTokens`, `response`, `toolCalls`
- [ ] Define `ToolCallLog` interface: `toolName`, `source`, `extensionName?`, `arguments`, `result?`, `success`, `autoApproved?`, `error?`, `startedAt`, `durationMs`
- [ ] Define `CreateAutomationInput` type (subset for creation)
- [ ] Define `UpdateAutomationInput` type (subset for updates)

### 3.4 Template Engine

File: `packages/worker-service/src/core/template-engine.ts`

- [ ] Implement `resolveTemplate(template: string, vars: Record<string, string>): string` (ADR-050 §6.1):
  1. Single-pass substitution: replace all `{{key}}` patterns in one `replace()` call
  2. Trim key whitespace: `key.trim()`
  3. Unresolved variables: keep as-is (return the original `{{key}}` match)
  4. Unescape literal braces: `\{\{` → `{{`, `\}\}` → `}}`
  5. **No second pass** — result is final, even if substituted values contain `{{ }}`

- [ ] Implement `buildTemplateVars(automation, stepIndex, stepOutputs, project)`:
  - Build the full variable map for a step:
    - `prev.output` — previous step's response text (empty for step 0)
    - `prev.json.*` — JSON parsed fields from previous step (if `outputFormat: "json"`)
    - `steps.{name}.output` — named step outputs from earlier steps
    - `variables.*` — user-defined automation variables
    - `project.name`, `project.id`
    - `now`, `now.date`, `now.time`
    - `worktree.path`, `worktree.branch` (if worktree enabled)

- [ ] Implement `parseJsonFields(response: string): Record<string, string>`:
  - `JSON.parse()` with try/catch
  - On parse error: return `{ "*": "[JSON parse error: invalid response from previous step]" }`
  - Support bracket notation: `results[0].name` via recursive field access
  - Missing fields resolve to `""` (empty string)

### 3.5 AutomationEngine — CRUD Operations

File: `packages/worker-service/src/core/automation-engine.ts`

- [ ] Export `AutomationEngine` class with constructor accepting `db`, `copilotBridge`, `worktreeManager`, `io`
- [ ] Private fields: `scheduledJobs: Map<string, cron.ScheduledTask>`, `activeRuns: Map<string, AbortController>`, `pendingTimeouts: Map<string, NodeJS.Timeout>`

- [ ] Implement `createAutomation(projectId, def: CreateAutomationInput): Promise<Automation>`:
  - Generate UUID
  - Validate cron expression via `node-cron` validate
  - Serialize `chain`, `variables`, `worktree` to JSON columns
  - Insert into `_automations`
  - If `enabled`: schedule immediately
  - Return created automation

- [ ] Implement `updateAutomation(id, updates: UpdateAutomationInput): Promise<Automation>`:
  - Update `_automations` row, update `updated_at`
  - If schedule/enabled changed: unschedule old, reschedule new
  - Return updated automation

- [ ] Implement `deleteAutomation(id): Promise<void>`:
  - Unschedule if scheduled
  - Cancel active run if running
  - `DELETE FROM _automations WHERE id = ?` (cascades to runs/logs/tool_calls)

- [ ] Implement `getAutomation(id): Promise<Automation>`:
  - Query + parse JSON columns back to TypeScript types

- [ ] Implement `listAutomations(projectId): Promise<Automation[]>`:
  - Query by `project_id`, parse JSON columns

- [ ] Implement `toggleAutomation(id, enabled): Promise<void>`:
  - Update `enabled` column
  - If enabling: schedule
  - If disabling: unschedule, cancel active run if any

### 3.6 AutomationEngine — Scheduling

File: `packages/worker-service/src/core/automation-engine.ts`

- [ ] Implement `private scheduleAutomation(automation: Automation): void` (ADR-050 §11.1):
  - Only for `schedule.type === "cron"` with valid cron expression
  - Create `cron.schedule()` with timezone support
  - On trigger: check date range constraints (`startsAt`/`endsAt`), then call `executeChain()`
  - Store in `scheduledJobs` map

- [ ] Implement `private unscheduleAutomation(automationId: string): void`:
  - Get task from `scheduledJobs` map
  - Call `.stop()` on cron task
  - Remove from map

- [ ] Implement `private scheduleOnce(automation: Automation): void` (ADR-050 §11.2):
  - Calculate delay from `schedule.runAt` to now
  - If in the past: skip (log warning)
  - Use `setTimeout` with calculated delay
  - Store timeout in `pendingTimeouts` map
  - On fire: call `executeChain()`, then auto-disable automation

- [ ] Implement **concurrency guard** (ADR-050 §11.3):
  - Before executing: check if automation already has an active run in `activeRuns` map
  - If active: skip new run, log as `{ status: "skipped", reason: "previous_run_active" }`

### 3.7 AutomationEngine — Startup Reconciliation

File: `packages/worker-service/src/core/automation-engine.ts`

- [ ] Implement startup logic in `start()` (ADR-050 §5.3):
  1. Mark all `running` runs as `failed` with error "Worker restarted during execution"
  2. Re-evaluate pending one-time runs (schedule_type = 'once', enabled, run_at > now)
  3. Schedule all enabled cron automations
  4. Re-schedule all enabled extension cron jobs (Phase 6 adds this, stub the call for now)
  5. Log reconciliation actions

- [ ] Implement `stop()`:
  - Stop all scheduled cron tasks
  - Cancel all active runs via AbortController
  - Clear all pending timeouts

### 3.8 AutomationEngine — Run Management

File: `packages/worker-service/src/core/automation-engine.ts`

- [ ] Implement `triggerRun(automationId): Promise<string>`:
  - Get automation from DB
  - Check concurrency guard
  - Call `executeChain(automation, "manual")`
  - Return run ID

- [ ] Implement `cancelRun(runId): Promise<void>`:
  - Get AbortController from `activeRuns` map
  - Call `.abort()` — chain executor handles the signal

- [ ] Implement `listRuns(automationId, opts?): Promise<AutomationRun[]>`:
  - Query `_automation_runs` with optional status filter and limit
  - Join step count for summary

- [ ] Implement `getRunDetails(runId): Promise<AutomationRun>`:
  - Query run + step logs + tool calls (3-level join)
  - Parse JSON columns, assemble full `AutomationRun` with nested `StepExecution[]` and `ToolCallLog[]`

### 3.9 Automation Configuration

File: `packages/worker-service/src/core/automation-engine.ts`

- [ ] Define default config values matching ADR-050 §14:
  ```typescript
  const AUTOMATION_DEFAULTS = {
    retentionDays: 90,
    responseRetentionDays: 30,
    maxConcurrentRuns: 3,
    defaultMaxDurationMs: 300000,  // 5 min
    defaultStepTimeoutMs: 60000,   // 1 min
  };
  ```
- [ ] Read overrides from `~/.renre-kit/config.json` → `automations` key

### 3.10 Tests

File: `packages/worker-service/src/core/automation-engine.test.ts`

- [ ] Test CRUD: create, get, list, update, delete automation
- [ ] Test `createAutomation`: validates cron expression
- [ ] Test `toggleAutomation`: schedules/unschedules correctly
- [ ] Test concurrency guard: skips if previous run active
- [ ] Test `start()`: marks running runs as failed
- [ ] Test `start()`: schedules enabled cron automations
- [ ] Test `start()`: re-evaluates pending one-time runs
- [ ] Test `stop()`: cancels active runs and scheduled tasks

File: `packages/worker-service/src/core/template-engine.test.ts`

- [ ] Test basic variable substitution: `{{variables.name}}` → value
- [ ] Test `{{prev.output}}` substitution
- [ ] Test `{{prev.json.field}}` with valid JSON
- [ ] Test `{{prev.json.field}}` with invalid JSON → error message
- [ ] Test `{{prev.json.results[0].name}}` bracket notation
- [ ] Test missing fields resolve to empty string
- [ ] Test unresolved variables kept as-is
- [ ] Test single-pass: injected `{{}}` in values not re-evaluated
- [ ] Test literal brace escaping: `\{\{` → `{{`
- [ ] Test `{{now}}`, `{{now.date}}`, `{{now.time}}` produce valid timestamps
- [ ] Test `{{project.name}}`, `{{project.id}}`

## Verification

```bash
pnpm run lint
pnpm run lint:duplication
pnpm --filter @renre-kit/worker-service test -- --run automation-engine template-engine
pnpm run build
```
