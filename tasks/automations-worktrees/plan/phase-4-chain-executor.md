# Phase 4 — Chain Executor & Tool Integration

## Goal

Implement the chain execution pipeline: sequential prompt step execution via ephemeral CopilotBridge sessions, autopilot mode for unattended permission approval, tool governance integration, system prompt assembly, worktree creation during execution, and LogCollector for debug data capture.

## Reference

- ADR-050: Automations (§5, §5.1, §5.2, §7, §12)
- ADR-051: Worktree Management (§11 — AutomationEngine integration)
- ADR-047: Console Chat UI (CopilotBridge `closeSession()` amendment)

## Dependencies

- Phase 1 (WorktreeManager) — needed for worktree creation during chain execution
- Phase 2 (Worktree API) — WorktreeManager wired into app lifecycle
- Phase 3 (AutomationEngine Core) — CRUD, scheduling, data model, template engine

## Tasks

### 4.1 CopilotBridge: Add `closeSession()` Method

File: `packages/worker-service/src/core/copilot-bridge.ts` (amend existing)

- [ ] Implement `closeSession(sessionId: string): Promise<void>` (ADR-047 amendment):
  - Destroy the SDK session
  - Remove from internal `sessions` Map
  - Clean up event listeners
  - Critical for automation chains that create dozens of ephemeral sessions per run

### 4.2 Chain Execution: `executeChain()`

File: `packages/worker-service/src/core/automation-engine.ts`

- [ ] Implement `private executeChain(automation: Automation, trigger: "scheduled" | "manual"): Promise<void>` (ADR-050 §5):

  **Step a — Initialize run:**
  - **Global concurrency check**: if `activeRuns.size >= config.maxConcurrentRuns` (default 3), reject with 409 (too many concurrent runs)
  - Create `_automation_runs` record with status `running`
  - Create `AbortController` for the chain, store in `activeRuns` map
  - Set up chain timeout via `setTimeout` using `automation.maxDurationMs`

  **Step b — Worktree setup (ADR-051 §11):**
  - If `automation.worktree?.enabled`:
    1. Compute `targetBranch`: `automation.worktree.branch ?? await getCurrentBranch(projectPath)`
    2. Call `worktreeManager.create()` with:
       - `createBranch: true`
       - `baseBranch: targetBranch`
       - `cleanupPolicy: automation.worktree.cleanup`
       - `ttlMs: automation.worktree.ttlMs`
       - `createdBy: { type: "automation", automationId, automationRunId }`
    3. Set `executionContext.cwd = wt.path`
    4. Add `worktree.path` and `worktree.branch` to template vars
    5. Call `worktreeManager.markInUse(wt.id)`
    6. Record `worktreeId` in run record

  **Step c — Emit `automation:run-started`:**
  - To `project:{projectId}` room: `{ automationId, runId, automationName, trigger, worktreePath? }`

  **Step d — Execute steps sequentially** (see Task 4.3)

  **Step e — Finalize run status (ADR-050 §5 step 5):**
  - All steps completed, no skips → `completed`
  - All steps ran but some skipped → `completed_with_warnings`
  - Chain aborted (onError: "stop") → `failed`
  - Chain exceeded `maxDurationMs` → `timed_out`
  - `cancelRun()` called → `cancelled`

  **Step f — Worktree cleanup (ADR-050 §5 step 6):**
  - `cleanup: "always"` → `worktreeManager.remove(wt.id)`, update `AutomationRun.worktree.status = "cleaned_up"`
  - `cleanup: "on_success"` + success → `worktreeManager.remove(wt.id)`, update `worktree.status = "cleaned_up"`
  - `cleanup: "on_success"` + failure → retain for debugging, update `worktree.status = "retained"`
  - `cleanup: "never"` → retain, update `worktree.status = "retained"`
  - `cleanup: "ttl"` → retain, update `worktree.status = "active"` (WorktreeManager handles TTL expiry)

  **Step g — Emit `automation:run-completed`:**
  - To `project:{projectId}` room: `{ automationId, runId, status, durationMs }`

  **Step h — Cleanup:**
  - Remove from `activeRuns` map
  - Clear chain timeout

### 4.3 Step Execution Loop

File: `packages/worker-service/src/core/automation-engine.ts`

- [ ] Implement the per-step execution loop within `executeChain()` (ADR-050 §5 step 4):

  For each `PromptStep` in `automation.chain[]`:

  **4a. Check chain timeout/cancel:**
  - If `AbortController.signal.aborted` → mark run `timed_out` or `cancelled`, break

  **4b. Create step record:**
  - Insert `_automation_step_logs` with status `running`

  **4c. Emit `automation:step-started`:**
  - To `automation:{runId}` room: `{ stepId, stepIndex, stepName, model }`

  **4d. Resolve prompt template:**
  - Call `resolveTemplate()` with full variable map from `buildTemplateVars()`
  - Store resolved prompt in step record

  **4e. Create ephemeral Copilot session (ADR-050 §5 step 4e):**
  - `copilotBridge.createSession()` with:
    - `model: step.model`
    - `reasoningEffort: step.reasoningEffort`
    - Tools resolved from `step.tools` (built-in + extensions + MCP)
    - System prompt assembled per §12 (see Task 4.5)
    - `autopilot: true` (see Task 4.4)
    - `cwd: executionContext.cwd` (worktree path or project path)
    - `timeout: step.timeoutMs`

  **4f. Send prompt & collect response:**
  - Send resolved prompt to session
  - During streaming: emit `automation:message-delta { stepId, deltaContent }`
  - Per tool call: emit `automation:tool-called { stepId, toolName, source, durationMs, success, autoApproved? }`
  - Log debug events: emit `automation:log { level, message, timestamp }`
  - Record all tool calls to `_automation_tool_calls`
  - Record token counts

  **4g. Close ephemeral session:**
  - Call `copilotBridge.closeSession(sessionId)`

  **4h. Update step record:**
  - Status `completed`, response text, tokens, duration

  **4i. Emit `automation:step-completed`:**
  - To `automation:{runId}` room: `{ runId, stepId, stepIndex, status, durationMs, outputPreview }`
  - `outputPreview` = first 200 chars of response text

  **4j. Handle step timeout:**
  - If step exceeds `step.timeoutMs`: mark step `failed`, error: "Step timed out after {timeoutMs}ms"
  - Falls through to error handler (4k)

  **4k. Handle step error (ADR-050 §5 step 4k):**
  - Emit `automation:step-failed { stepId, stepIndex, error }`
  - `onError: "stop"` → mark run `failed`, break loop
  - `onError: "skip"` → mark step `skipped`, set `hasWarnings = true`, continue
  - `onError: "retry"` → retry up to `retryCount` times, then treat as "stop"

### 4.4 Autopilot Mode

File: `packages/worker-service/src/core/automation-engine.ts`

- [ ] Implement autopilot permission handling (ADR-050 §5.1):
  - When creating ephemeral session, pass `onPermissionRequest` hook:
    ```typescript
    onPermissionRequest: async (request) => {
      logger.info(`Autopilot: auto-approved ${request.kind} — ${request.details}`);
      // Log to _automation_tool_calls with auto_approved = 1
      return { decision: "approved" };
    }
    ```
  - Every auto-approved permission logged with `auto_approved: true` in `_automation_tool_calls`
  - **Guardrail**: Tool governance (ADR-029) `preToolUse` hooks are evaluated **before** autopilot. Denied tools are blocked regardless of autopilot mode.

### 4.5 System Prompt Assembly

File: `packages/worker-service/src/core/automation-engine.ts`

- [ ] Implement 3-layer system prompt assembly (ADR-050 §12):
  1. **Project context** — assembled by `ContextRecipeEngine` (ADR-035):
     - Session memory, observations, tool rules, extension context
     - Token budget proportional to step position (more context for early steps)
  2. **Automation-level system prompt** — user-defined in `automation.systemPrompt`
     - Run through `resolveTemplate()` for variable substitution
  3. **Chain execution context** — auto-injected:
     ```
     This is step {n} of {total} in an automated workflow.
     You will receive the output of the previous step as context.
     Respond with {outputFormat}.
     ```
- [ ] Concatenate all three layers with clear section separators

### 4.6 Tool Governance Integration

File: `packages/worker-service/src/core/automation-engine.ts`

- [ ] Wire tool governance (ADR-050 §5.2):
  1. `preToolUse` hook fires for every tool call during step execution
  2. If governance rule returns `deny`:
     - Tool call blocked, logged to `_automation_tool_calls` with `success: false, error: "Denied by rule: {ruleName}"`
     - Counts as tool execution error → triggers step's `onError` handling
  3. Governance audit entries written to **both** `_tool_audit` (global) and `_automation_tool_calls` (automation-specific)

### 4.7 Tool Resolution

File: `packages/worker-service/src/core/automation-engine.ts`

- [ ] Implement tool resolution for each step (ADR-050 §7):
  - `step.tools.builtIn: true` → `CopilotBridge.buildBuiltInTools(projectId)` with `cwd` set to execution context
  - `step.tools.extensions` → `CopilotBridge.buildExtensionTools(projectId, allowedExtensions)`
    - `"all"` passes all installed extensions
    - Array passes specific extension names
  - `step.tools.mcp` → `CopilotBridge.buildMcpTools(projectId, allowedMcpServers)`
    - `"all"` passes all configured MCP servers
    - Array passes specific server names

### 4.8 LogCollector

File: `packages/worker-service/src/core/automation-engine.ts` (or `log-collector.ts`)

- [ ] Implement debug data capture for each step:
  - Resolved prompt (after template substitution)
  - System prompt (all 3 layers)
  - Model and reasoning effort
  - Input/output token counts
  - Full LLM response text
  - Every tool call with: name, source, arguments, result, success, autoApproved, error, timing
  - Step timing (start, end, duration)
- [ ] Write all data to `_automation_step_logs` and `_automation_tool_calls` tables
- [ ] Handle large responses: truncate `result_json` in `_automation_tool_calls` if > 10KB

### 4.9 Tests

File: `packages/worker-service/src/core/chain-executor.test.ts`

- [ ] Test chain execution: 3-step chain completes successfully
- [ ] Test chain execution: `{{prev.output}}` piped between steps
- [ ] Test chain execution: `{{prev.json.field}}` works with JSON output
- [ ] Test chain execution: step timeout marks step as failed
- [ ] Test chain execution: chain timeout marks run as `timed_out`
- [ ] Test chain execution: `cancelRun()` marks run as `cancelled`
- [ ] Test onError "stop": chain aborts on step failure
- [ ] Test onError "skip": chain continues, run status `completed_with_warnings`
- [ ] Test onError "retry": step retried up to retryCount
- [ ] Test autopilot: permission requests auto-approved and logged
- [ ] Test tool governance: denied tools blocked, logged as error
- [ ] Test worktree integration: worktree created when `worktree.enabled`
- [ ] Test worktree cleanup: `cleanup: "always"` removes after run
- [ ] Test worktree cleanup: `cleanup: "on_success"` retains on failure
- [ ] Test ephemeral sessions: `closeSession()` called after each step
- [ ] Test system prompt assembly: 3 layers concatenated correctly
- [ ] Test tool resolution: built-in, extension, MCP tools resolved per step config

## Verification

```bash
pnpm run lint
pnpm run lint:duplication
pnpm --filter @renre-kit/worker-service test -- --run chain-executor
pnpm run build
```
