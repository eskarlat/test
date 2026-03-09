# ADR-050: Automations — Scheduled Prompt Chains with Agent Tooling

## Status
Proposed

## Context

RenRe Kit provides rich project context (extensions, MCPs, vault, hooks, observations) and a Chat interface (ADR-047) for interactive LLM interaction. However, many workflows are repetitive and predictable — daily code reviews, periodic dependency audits, scheduled report generation, nightly test analysis, on-commit changelog drafts. Currently these require manual initiation via the Chat page or external tooling.

Users need the ability to define **automated workflows** that:
- Run on a schedule (cron) or at specific dates/times
- Chain multiple LLM prompts where the output of one feeds the input of the next
- Allow different models and reasoning efforts per step (e.g., fast model for data gathering, powerful model for analysis)
- Access the full RenRe Kit tooling surface — built-in tools, extension tools, MCP tools
- Include project-specific system prompts (injected by Console UI context)
- Provide detailed execution logs for debugging (prompts, tool calls, LLM responses, timing)

Additionally, extensions need the ability to schedule their own cron jobs — e.g., a Jira extension syncing issues every 30 minutes, or a monitoring extension polling health endpoints. However, **extension cron jobs must be fully isolated from core automations** — an extension must not be able to read, modify, cancel, or interfere with user-created automation schedules. Extensions get a scoped scheduler interface, not raw access to the `AutomationEngine`.

No existing ADR covers scheduled autonomous agent execution, prompt chaining, or extension-level scheduling.

## Decision

### 1. Architecture Overview

Automations are **project-scoped**. Each automation belongs to a project and inherits its extensions, hooks, tool governance, and context recipes. The worker service manages scheduling and execution.

```
Console UI (React)                Worker Service (Express)           Copilot CLI
┌────────────────────┐           ┌──────────────────────────┐       ┌──────────────┐
│  Automations Page  │◄─ IO ──►│  AutomationEngine        │       │              │
│  - Chain editor    │           │    Scheduler (cron)      │──────►│  JSON-RPC    │
│  - Run history     │── HTTP ──►│    ChainExecutor         │       │  (stdio)     │
│  - Log viewer      │           │    CopilotBridge (reuse) │◄─────│              │
│  - Debug panel     │           │    LogCollector          │       └──────────────┘
└────────────────────┘           └──────────────────────────┘
```

**Components:**
- **AutomationEngine** — manages user automation CRUD, scheduling, and execution lifecycle
- **Scheduler** — cron-based timer using `node-cron` with date/time constraints
- **ChainExecutor** — runs prompt steps sequentially, piping outputs to inputs
- **LogCollector** — captures debug-level execution data (prompts, tool calls, timing, responses)
- **CopilotBridge** — reused from ADR-047 for LLM interaction (sessions, tools, streaming)
- **ExtensionScheduler** — scoped cron interface for extensions, isolated from core automations

### 2. Data Model

#### 2.1 Automation Definition

```typescript
interface Automation {
  id: string;                     // UUID
  projectId: string;              // Owner project
  name: string;                   // User-defined label
  description?: string;           // Optional description
  enabled: boolean;               // Active/paused toggle
  schedule: AutomationSchedule;   // When to run
  chain: PromptStep[];            // Ordered array of prompt steps
  systemPrompt?: string;          // Project-specific system prompt (set via Console UI)
  variables?: Record<string, string>;  // User-defined variables available in prompts as {{var}}
  worktree?: WorktreeConfig;      // Optional: run in an isolated git worktree (ADR-051)
  maxDurationMs?: number;         // Total chain timeout (default: 300000 = 5 min)
  createdAt: string;              // ISO timestamp
  updatedAt: string;              // ISO timestamp
}

interface WorktreeConfig {
  enabled: boolean;               // Whether to create/use a worktree for this automation
  branch?: string;                // Branch to check out (default: current branch)
  cleanup: "always" | "on_success" | "never" | "ttl";  // When to remove worktree after run
  ttlMs?: number;                 // For "ttl" policy (default: 24h from config)
}

interface AutomationSchedule {
  type: "cron" | "once" | "manual";
  cron?: string;                  // Standard cron expression (e.g., "0 9 * * 1-5")
  timezone?: string;              // IANA timezone (default: system timezone)
  runAt?: string;                 // ISO datetime for type: "once"
  startsAt?: string;              // Effective date range start (optional)
  endsAt?: string;                // Effective date range end (optional)
}

interface PromptStep {
  id: string;                     // Step UUID
  name: string;                   // Display name (e.g., "Gather data", "Analyze")
  prompt: string;                 // Prompt template — can reference {{prev.output}}, {{variables.*}}
  model: string;                  // Model ID from listModels()
  reasoningEffort?: "low" | "medium" | "high";   // Model effort level
  tools: ToolAccess;              // Which tools this step can use
  maxTokens?: number;             // Response token limit (optional)
  timeoutMs?: number;             // Step-level timeout (default: 60000 = 1 min)
  onError: "stop" | "skip" | "retry"; // Error handling strategy
  retryCount?: number;            // Max retries when onError is "retry" (default: 2)
  outputFormat?: "text" | "json"; // Expected output format (helps chain parsing)
}

interface ToolAccess {
  builtIn: boolean;               // Enable built-in tools (file read, search, etc.)
  extensions: string[] | "all";   // Extension names or "all" — extension routes + MCP tools
  mcp: string[] | "all";          // MCP server names or "all"
}
```

#### 2.2 Execution Records

```typescript
interface AutomationRun {
  id: string;                     // Run UUID
  automationId: string;
  projectId: string;
  status: "pending" | "running" | "completed" | "completed_with_warnings" | "failed" | "cancelled" | "timed_out";
  trigger: "scheduled" | "manual";  // How this run was initiated
  worktree?: WorktreeRunInfo;     // Present when automation uses worktree
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  steps: StepExecution[];         // Per-step execution details
  error?: string;                 // Top-level error if chain failed
}

interface WorktreeRunInfo {
  worktreeId: string;             // Reference to _worktrees table (ADR-051)
  path: string;                   // Worktree filesystem path
  branch: string;                 // Branch checked out
  status: "active" | "cleaned_up" | "retained";  // Post-run state
}

interface StepExecution {
  stepId: string;
  stepName: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;

  // Debug data
  resolvedPrompt: string;         // Prompt after variable/output substitution
  systemPrompt: string;           // System prompt used for this step
  model: string;
  reasoningEffort?: string;

  // LLM interaction
  inputTokens?: number;
  outputTokens?: number;
  response?: string;              // Full LLM response text

  // Tool usage
  toolCalls: ToolCallLog[];       // Every tool call made during this step
  error?: string;
}

interface ToolCallLog {
  toolName: string;
  source: "built-in" | "extension" | "mcp";
  extensionName?: string;         // If source is "extension" or "mcp"
  arguments: Record<string, unknown>;
  result?: unknown;
  success: boolean;
  autoApproved?: boolean;         // true when approved by autopilot mode (§5.1)
  error?: string;
  startedAt: string;
  durationMs: number;
}
```

### 3. SQLite Schema

```sql
-- Core automation definitions
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
  chain_json TEXT NOT NULL,         -- JSON array of PromptStep[]
  system_prompt TEXT,
  variables_json TEXT,              -- JSON object of variables
  worktree_json TEXT,               -- JSON object of WorktreeConfig (null if not used)
  max_duration_ms INTEGER DEFAULT 300000,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_automations_project ON _automations(project_id);
CREATE INDEX idx_automations_enabled ON _automations(project_id, enabled);

-- Execution history
CREATE TABLE _automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES _automations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'completed_with_warnings', 'failed', 'cancelled', 'timed_out')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  duration_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_runs_automation ON _automation_runs(automation_id);
CREATE INDEX idx_runs_project_status ON _automation_runs(project_id, status);
CREATE INDEX idx_runs_started ON _automation_runs(started_at);

-- Per-step execution details (debug logs)
CREATE TABLE _automation_step_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES _automation_runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  step_name TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  resolved_prompt TEXT,             -- Prompt after substitution
  system_prompt TEXT,
  model TEXT NOT NULL,
  reasoning_effort TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  response TEXT,                    -- Full LLM response
  error TEXT
);

CREATE INDEX idx_step_logs_run ON _automation_step_logs(run_id);

-- Tool call logs within a step
CREATE TABLE _automation_tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_log_id TEXT NOT NULL REFERENCES _automation_step_logs(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('built-in', 'extension', 'mcp')),
  extension_name TEXT,
  arguments_json TEXT,
  result_json TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  auto_approved INTEGER DEFAULT 0,   -- 1 when approved by autopilot mode
  error TEXT,
  started_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL
);

CREATE INDEX idx_tool_calls_step ON _automation_tool_calls(step_log_id);
```

### 4. Worker Service: AutomationEngine

```typescript
// packages/worker-service/src/core/automation-engine.ts

import cron from "node-cron";

class AutomationEngine {
  private scheduledJobs: Map<string, cron.ScheduledTask> = new Map();
  private activeRuns: Map<string, AbortController> = new Map();
  private db: Database;
  private copilotBridge: CopilotBridge;

  constructor(db: Database, copilotBridge: CopilotBridge) { ... }

  // --- Lifecycle ---

  /** Load all enabled automations and schedule them. Called at worker startup. */
  async start(): Promise<void>;

  /** Cancel all scheduled jobs and running executions. Called at worker shutdown. */
  async stop(): Promise<void>;

  // --- CRUD ---

  async createAutomation(projectId: string, def: CreateAutomationInput): Promise<Automation>;
  async updateAutomation(id: string, updates: UpdateAutomationInput): Promise<Automation>;
  async deleteAutomation(id: string): Promise<void>;
  async getAutomation(id: string): Promise<Automation>;
  async listAutomations(projectId: string): Promise<Automation[]>;
  async toggleAutomation(id: string, enabled: boolean): Promise<void>;

  // --- Execution ---

  /** Manually trigger an automation run (outside its schedule). */
  async triggerRun(automationId: string): Promise<string /* runId */>;

  /** Cancel a running automation. */
  async cancelRun(runId: string): Promise<void>;

  /** Get run history with optional filters. */
  async listRuns(automationId: string, opts?: { limit?: number; status?: string }): Promise<AutomationRun[]>;

  /** Get full run details including step logs and tool calls. */
  async getRunDetails(runId: string): Promise<AutomationRun>;

  // --- Internal ---

  private scheduleAutomation(automation: Automation): void;
  private unscheduleAutomation(automationId: string): void;
  private executeChain(automation: Automation, trigger: "scheduled" | "manual"): Promise<void>;
}
```

### 5. Chain Execution Flow

```
triggerRun(automationId) or cron fires
  │
  ├── 1. Create AutomationRun record (status: "running")
  ├── 2. If worktree.enabled:
  │     ├── Create worktree via WorktreeManager (ADR-051)
  │     ├── Set CWD for all tool executions to worktree path
  │     └── Record worktreeId in AutomationRun
  ├── 3. Emit Socket.IO: automation:run-started { automationId, runId, worktreePath? }
  │
  ├── 4. For each PromptStep in chain[]:
  │     │
  │     ├── a. Check chain timeout (AbortController signal)
  │     │       - If maxDurationMs exceeded → mark run "timed_out", break
  │     │       - If cancelRun() called → mark run "cancelled", break
  │     │
  │     ├── b. Create StepExecution record (status: "running")
  │     ├── c. Emit Socket.IO: automation:step-started { stepId, stepIndex, stepName, model }
  │     │
  │     ├── d. Resolve prompt template (single-pass, §6.1):
  │     │       - {{prev.output}}, {{prev.json.*}} from previous step
  │     │       - {{steps.{name}.output}} from any named earlier step
  │     │       - {{variables.*}} from automation variables
  │     │       - {{project.name}}, {{project.id}}
  │     │       - {{now}}, {{now.date}}, {{now.time}}
  │     │       - {{worktree.path}}, {{worktree.branch}} (if worktree enabled)
  │     │
  │     ├── e. Create ephemeral Copilot session:
  │     │       - model: step.model
  │     │       - reasoningEffort: step.reasoningEffort
  │     │       - tools: resolved from step.tools (built-in + extensions + MCP)
  │     │       - systemPrompt: automation.systemPrompt + project context
  │     │       - autopilot: true (§5.1 — auto-approve all permission requests)
  │     │       - preToolUse: tool governance check (§5.2)
  │     │       - timeout: step.timeoutMs (per-step timeout)
  │     │
  │     ├── f. Send resolved prompt → collect full response
  │     │       - Emit automation:message-delta { stepId, deltaContent } during streaming
  │     │       - Emit automation:tool-called { stepId, toolName, source, durationMs, success, autoApproved? } per tool
  │     │       - Emit automation:log { level, message, timestamp } for debug events
  │     │       - Tool calls logged to _automation_tool_calls (+ _tool_audit for governance)
  │     │       - Token counts recorded
  │     │
  │     ├── g. Close ephemeral session via CopilotBridge.closeSession()
  │     ├── h. Update StepExecution (status: "completed", response, tokens, duration)
  │     ├── i. Emit Socket.IO: automation:step-completed { runId, stepId, stepIndex, status, durationMs, outputPreview }
  │     │       (outputPreview = first 200 chars of response text)
  │     │
  │     ├── j. On step timeout → mark step "failed", error: "Step timed out after {timeoutMs}ms"
  │     │       Falls through to error handler (k)
  │     │
  │     └── k. On error:
  │           ├── Emit Socket.IO: automation:step-failed { stepId, stepIndex, error }
  │           ├── onError: "stop"  → mark run as "failed", break
  │           ├── onError: "skip"  → mark step "skipped", set hasWarnings=true, continue
  │           └── onError: "retry" → retry up to retryCount, then "stop" or "skip"
  │
  ├── 5. Update AutomationRun status:
  │     ├── All steps completed, no skips → "completed"
  │     ├── All steps ran but some skipped → "completed_with_warnings"
  │     ├── Chain aborted (onError: "stop") → "failed"
  │     ├── Chain exceeded maxDurationMs → "timed_out"
  │     └── cancelRun() called → "cancelled"
  ├── 6. If worktree.enabled:
  │     ├── cleanup: "always"     → remove worktree
  │     ├── cleanup: "on_success" → remove only if status is "completed" or "completed_with_warnings"
  │     ├── cleanup: "never"      → retain (user manages via Worktrees page)
  │     └── cleanup: "ttl"        → retain, WorktreeManager handles TTL expiry (ADR-051 §9.1)
  └── 7. Emit Socket.IO: automation:run-completed { automationId, runId, status, durationMs }
```

**Ephemeral sessions**: Each step creates a new Copilot session (via `CopilotBridge.createSession`) with the step's model/effort/tools, sends one prompt, collects the response, then explicitly closes the session via `CopilotBridge.closeSession(sessionId)`. This ensures clean tool/model isolation between steps and prevents memory leaks.

> **ADR-047 amendment**: `CopilotBridge` must expose a public `closeSession(sessionId: string): Promise<void>` method that destroys the SDK session, removes it from the internal `sessions` Map, and cleans up event listeners. This is critical for automation chains that may create dozens of ephemeral sessions per run.

### 5.1 Autopilot Mode (Permission Handling)

Automations run unattended — there is no human to approve permission requests (file writes, tool executions). Automations use **autopilot mode**: all permission requests from the LLM are **auto-approved** and logged.

**User notification flow:**

1. When a user **creates or enables** an automation, the Console UI shows a confirmation dialog:
   ```
   ┌─────────────────────────────────────────────────────────┐
   │  Enable Autopilot Mode                                   │
   ├─────────────────────────────────────────────────────────┤
   │                                                         │
   │  This automation will run in autopilot mode.            │
   │                                                         │
   │  All tool permission requests (file writes, shell       │
   │  commands, API calls) will be automatically approved    │
   │  without human review.                                  │
   │                                                         │
   │  You can review all actions in the run logs afterward.  │
   │                                                         │
   │  Tool governance rules (ADR-029) still apply — denied   │
   │  tools will be blocked regardless of autopilot mode.    │
   │                                                         │
   │                          [Cancel]  [Enable Autopilot]    │
   └─────────────────────────────────────────────────────────┘
   ```
2. The automation definition stores `autopilot: true` (always true for automations; the dialog is informational).
3. During execution, every auto-approved permission is logged in `_automation_tool_calls` with `auto_approved: true`.
4. The Run Detail view highlights auto-approved actions with a distinct badge so users can audit post-run.

**Integration with CopilotBridge:**

```typescript
// When creating ephemeral session for automation step
const sdkSession = await this.client!.createSession({
  model: step.model,
  // ... other options
  hooks: {
    onPermissionRequest: async (request) => {
      // Auto-approve all permissions in autopilot mode
      logger.info(`Autopilot: auto-approved ${request.kind} — ${request.details}`);
      logToolCall(runId, stepId, {
        toolName: request.details,
        autoApproved: true,
        kind: request.kind,
      });
      return { decision: "approved" };
    },
  },
});
```

**Guardrails**: Tool governance rules (ADR-029) are evaluated **before** the permission request reaches autopilot. If a `preToolUse` hook returns `"deny"`, the tool is blocked regardless of autopilot. Autopilot only applies to tools that pass governance checks.

### 5.2 Tool Governance Integration

Tool governance (ADR-029) applies to automation sessions exactly as it does to interactive chat:

1. **`preToolUse` hook fires for every tool call** during automation step execution
2. If a governance rule returns `"deny"`:
   - The tool call is **blocked** and logged to `_automation_tool_calls` with `success: false, error: "Denied by rule: {ruleName}"`
   - This counts as a **tool execution error**, which triggers the step's `onError` handling:
     - `onError: "stop"` → step fails, chain aborts
     - `onError: "skip"` → tool is skipped, LLM may retry with another approach
     - `onError: "retry"` → step retries (governance may deny again)
3. `preToolUse` hooks fire once per ephemeral session step — each step is an independent session
4. Governance audit entries are written to **both** `_tool_audit` (global governance log, ADR-029) and `_automation_tool_calls` (automation-specific log) for full traceability

### 5.3 Startup Reconciliation

When the worker service starts (or restarts after a crash), `AutomationEngine.start()` must reconcile state:

```typescript
async start(): Promise<void> {
  // 1. Recover crashed runs: mark "running" runs as "failed"
  this.db.prepare(`
    UPDATE _automation_runs
    SET status = 'failed', error = 'Worker restarted during execution',
        completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE status = 'running'
  `).run();

  // 2. Reconcile worktrees from crashed runs (delegate to WorktreeManager)
  // WorktreeManager.start() handles orphan detection (see ADR-051 §9.2)

  // 3. Re-evaluate pending one-time runs
  const pendingOnce = this.db.prepare(`
    SELECT * FROM _automations
    WHERE schedule_type = 'once' AND enabled = 1
      AND schedule_run_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).all();
  for (const auto of pendingOnce) {
    this.scheduleOnce(auto);
  }

  // 4. Schedule all enabled cron automations
  const cronAutomations = this.db.prepare(`
    SELECT * FROM _automations
    WHERE schedule_type = 'cron' AND enabled = 1
  `).all();
  for (const auto of cronAutomations) {
    this.scheduleAutomation(auto);
  }

  // 5. Re-schedule all enabled extension cron jobs for active projects
  const extJobs = this.db.prepare(`
    SELECT * FROM _scheduler_jobs WHERE enabled = 1
  `).all();
  for (const job of extJobs) {
    this.scheduleExtensionJob(job);
  }
}
```

### 6. Prompt Template Variables

Templates use `{{variable}}` syntax (double curly braces). Available variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `{{prev.output}}` | Previous step's full response text | — |
| `{{prev.json.*}}` | JSON field from previous step (when `outputFormat: "json"`) | `{{prev.json.summary}}` |
| `{{steps.{name}.output}}` | Output from a named earlier step | `{{steps.gather.output}}` |
| `{{variables.{key}}}` | User-defined automation variable | `{{variables.repo_url}}` |
| `{{project.name}}` | Current project name | `my-app` |
| `{{project.id}}` | Current project ID | `proj_abc123` |
| `{{now}}` | Current ISO datetime | `2026-03-09T14:30:00Z` |
| `{{now.date}}` | Current date | `2026-03-09` |
| `{{now.time}}` | Current time | `14:30:00` |
| `{{worktree.path}}` | Worktree directory path (when worktree enabled) | `/tmp/renre-wt/proj-abc/auto-xyz` |
| `{{worktree.branch}}` | Worktree branch name | `main` |

### 6.1 Template Escaping & Safety

Template variable substitution must handle untrusted content safely, since `{{prev.output}}` contains LLM-generated text that could include template syntax or injection attempts.

**Escaping rules:**

1. **One-pass substitution**: The template engine performs a **single pass** over the prompt. After substitution, the result is treated as literal text — no re-evaluation. This prevents recursive injection where `{{prev.output}}` contains `{{variables.secret}}`.

2. **Literal braces**: To include literal `{{` in a prompt, escape as `\{\{`. The engine replaces `\{\{` → `{{` after variable substitution.

3. **JSON field access safety**:
   - `{{prev.json.field}}` uses `JSON.parse()` with a try/catch. If parsing fails, the variable resolves to `"[JSON parse error: invalid response from previous step]"` and step continues.
   - Field path traversal uses bracket notation: `{{prev.json.results[0].name}}` is supported.
   - Missing fields resolve to `""` (empty string), not `undefined` or error.

4. **Output placement**: Previous step output is always injected into the **user message**, never the system prompt. The system prompt is assembled from trusted sources only (automation config, project context, chain metadata).

5. **No shell interpolation**: Template variables are never passed through shell evaluation. Built-in tools that execute shell commands receive the resolved prompt as a string argument, not as a shell-interpolated command.

```typescript
// Template engine — single-pass, no re-evaluation
function resolveTemplate(template: string, vars: Record<string, string>): string {
  // 1. Replace all known {{var}} patterns in one pass
  let result = template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const value = vars[key.trim()];
    return value !== undefined ? value : match; // Keep unresolved vars as-is
  });

  // 2. Unescape literal braces
  result = result.replace(/\\\{/g, "{").replace(/\\\}/g, "}");

  return result;
  // No second pass — result is final, even if it contains {{ }}
}
```

### 7. Tool Access

Each step declares which tools it can use:

```typescript
tools: {
  builtIn: true,                  // File read, search, shell, etc.
  extensions: ["jira-plugin"],    // Only jira-plugin routes
  mcp: ["github-mcp"],            // Only github MCP tools
}
```

Tools are resolved at step execution time via the same mechanism as ADR-047 Chat sessions:

1. **Built-in tools** — `CopilotBridge.buildBuiltInTools(projectId)` — file operations, search, shell commands
2. **Extension tools** — `CopilotBridge.buildExtensionTools(projectId, allowedExtensions)` — extension HTTP routes exposed as tools
3. **MCP tools** — `CopilotBridge.buildMcpTools(projectId, allowedMcpServers)` — MCP server tools via the bridge (ADR-008)

All tool calls during automation execution are logged with arguments, results, timing, and success/failure.

### 8. REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/{pid}/automations` | GET | List automations for project |
| `/api/{pid}/automations` | POST | Create automation |
| `/api/{pid}/automations/{id}` | GET | Get automation details |
| `/api/{pid}/automations/{id}` | PUT | Update automation |
| `/api/{pid}/automations/{id}` | DELETE | Delete automation |
| `/api/{pid}/automations/{id}/toggle` | POST | Enable/disable automation |
| `/api/{pid}/automations/{id}/trigger` | POST | Manually trigger a run |
| `/api/{pid}/automations/{id}/runs` | GET | List run history |
| `/api/{pid}/automations/{id}/runs/{runId}` | GET | Get run details (steps + tool calls) |
| `/api/{pid}/automations/{id}/runs/{runId}/cancel` | POST | Cancel running automation |
| `/api/{pid}/automations/models` | GET | List available models (proxy to CopilotBridge) |

### 9. Socket.IO Events

New room: `automation:{runId}` — clients join when viewing a running automation. Clients emit `automation:join` / `automation:leave` to manage room membership (same pattern as `project:join` / `chat:join` in ADR-048).

> **ADR-048 amendment**: The following must be added to ADR-048's room design and connection handling:
> - New room type `automation:{runId}` with events listed below
> - Client `automation:join` / `automation:leave` events in the `io.on("connection")` handler
> - `automation:*` events forwarded from EventBus to appropriate rooms in `socket-bridge.ts`

```
room: "project:{projectId}"
  ├── automation:run-started     { automationId, runId, automationName, trigger, worktreePath? }
  ├── automation:run-completed   { automationId, runId, status, durationMs }
  └── automation:run-failed      { automationId, runId, error }

room: "automation:{runId}"
  ├── automation:step-started    { stepId, stepIndex, stepName, model }
  ├── automation:step-completed  { stepId, stepIndex, status, durationMs, outputPreview }
  ├── automation:step-failed     { stepId, stepIndex, error }
  ├── automation:tool-called     { stepId, toolName, source, durationMs, success, autoApproved? }
  ├── automation:message-delta   { stepId, deltaContent }    // LLM streaming for live view
  └── automation:log             { level, message, timestamp }
```

### 10. Console UI: Automations Page

Added to the sidebar under core pages. URL: `/:projectId/automations`.

#### 10.1 Automation List View

```
┌─────────────────────────────────────────────────────────────────────┐
│  Automations                                      [+ New Automation]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─ Daily Code Review ───────────────────────────── ON ──────────┐ │
│  │  ⏰ Every weekday at 9:00 AM  │  3 steps  │  Last: ✓ 2m ago  │ │
│  │  Models: gpt-4o → claude-sonnet → gpt-4o                      │ │
│  │                                         [Run Now] [Edit] [···]│ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ Weekly Dependency Audit ─────────────────────── ON ──────────┐ │
│  │  ⏰ Mondays at 8:00 AM       │  2 steps  │  Last: ✓ 5d ago   │ │
│  │  Models: claude-sonnet → claude-opus                           │ │
│  │                                         [Run Now] [Edit] [···]│ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ On-Demand Test Analysis ─────────────────────── — ──────────┐ │
│  │  Manual trigger only          │  1 step   │  Last: ✓ 1h ago   │ │
│  │  Model: claude-opus (high effort)                              │ │
│  │                                         [Run Now] [Edit] [···]│ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 10.2 Chain Editor (Create/Edit)

Visual chain builder showing the prompt pipeline. Each section includes a `[?]` help icon that opens an inline help panel explaining that section.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Edit: Daily Code Review                    [? Help] [Save] [Cancel]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Name: [Daily Code Review          ]                                │
│  Description: [Reviews yesterday's commits and generates summary  ] │
│                                                                     │
│  ── Schedule [?] ──────────────────────────────────────────────────  │
│  Type: (●) Cron  ( ) Once  ( ) Manual                               │
│  Cron: [0 9 * * 1-5      ]  "Every weekday at 9:00 AM"             │
│  Timezone: [America/New_York ▼]                                     │
│  Active from: [          ] to [          ]  (optional date range)    │
│                                                                     │
│  ── Worktree [?] ─────────────────────────────────────────────────  │
│  [✓] Run in isolated worktree                                       │
│  Branch: [main ▼]                                                   │
│  Cleanup: [On success ▼]  (always | on success | never)             │
│  ┌─ ℹ Worktree creates a separate working copy so the automation   ─┐
│  │  can read/modify files without affecting your main checkout.     │
│  │  Manage worktrees: Worktrees page. See ADR-051.                  │
│  └──────────────────────────────────────────────────────────────────┘
│                                                                     │
│  ── System Prompt [?] ─────────────────────────────────────────────  │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ You are a senior code reviewer for the {{project.name}}     │    │
│  │ project. Focus on security, performance, and best practices.│    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ── Variables [?] ─────────────────────────────────────────────────  │
│  branch: [main           ]                                          │
│  review_depth: [detailed ]          [+ Add Variable]                │
│                                                                     │
│  ── Prompt Chain [?] ──────────────────────────────────────────────  │
│                                                                     │
│  ┌─ Step 1: Gather Changes ─────────────────────────────────────┐  │
│  │  Model: [gpt-4o ▼]  Effort: [low ▼]  Timeout: [30s   ]      │  │
│  │  Tools: [✓] Built-in  Extensions: [all ▼]  MCP: [github ▼]  │  │
│  │  On Error: [stop ▼]                                           │  │
│  │  Output: (●) Text  ( ) JSON                                   │  │
│  │  ┌────────────────────────────────────────────────────────┐   │  │
│  │  │ List all commits from yesterday on branch              │   │  │
│  │  │ {{variables.branch}}. For each commit, show the diff   │   │  │
│  │  │ and files changed. Format as a structured summary.     │   │  │
│  │  └────────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│        │                                                            │
│        ▼ output feeds into next step                                │
│  ┌─ Step 2: Analyze & Review ───────────────────────────────────┐  │
│  │  Model: [claude-sonnet ▼]  Effort: [high ▼]  Timeout: [60s] │  │
│  │  Tools: [✓] Built-in  Extensions: [jira ▼]  MCP: [none ▼]   │  │
│  │  On Error: [stop ▼]                                           │  │
│  │  Output: (●) Text  ( ) JSON                                   │  │
│  │  ┌────────────────────────────────────────────────────────┐   │  │
│  │  │ Review the following code changes for security issues, │   │  │
│  │  │ performance problems, and best practice violations:    │   │  │
│  │  │                                                        │   │  │
│  │  │ {{prev.output}}                                        │   │  │
│  │  │                                                        │   │  │
│  │  │ Create Jira tickets for any critical findings.         │   │  │
│  │  └────────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│        │                                                            │
│        ▼                                                            │
│  ┌─ Step 3: Generate Summary ───────────────────────────────────┐  │
│  │  Model: [gpt-4o ▼]  Effort: [low ▼]  Timeout: [30s   ]      │  │
│  │  Tools: [ ] Built-in  Extensions: [none ▼]  MCP: [none ▼]   │  │
│  │  On Error: [skip ▼]                                           │  │
│  │  Output: (●) Text  ( ) JSON                                   │  │
│  │  ┌────────────────────────────────────────────────────────┐   │  │
│  │  │ Summarize the following code review into a brief       │   │  │
│  │  │ daily digest (3-5 bullet points):                      │   │  │
│  │  │                                                        │   │  │
│  │  │ {{prev.output}}                                        │   │  │
│  │  └────────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  [+ Add Step]                                                       │
│                                                                     │
│  ── Max Duration ──────────────────────────────────────────────────  │
│  Total chain timeout: [5 ] minutes                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 10.2.1 Inline Help Panels

Each section header has a `[?]` icon. Clicking it reveals a collapsible help panel directly below the section header. The top-level `[? Help]` button opens a full-page help drawer.

**Section help content:**

| Section | Help Panel Content |
|---------|-------------------|
| **Schedule** | Cron syntax reference with examples: `*/5 * * * *` = every 5 min, `0 9 * * 1-5` = weekdays 9 AM. Links to crontab.guru. Explains "Once" (runs at exact datetime then auto-disables) and "Manual" (only via Run Now button). Date range constrains when cron is active. |
| **Worktree** | Explains that worktrees create an isolated git working copy so automation tools can read/write files without affecting the user's checkout. Shows when to use it (code modifications, branch-based analysis) vs. when not needed (read-only queries). Links to Worktrees management page (ADR-051). Cleanup options explained. |
| **System Prompt** | Explains that this prompt is injected as context for every step in the chain. Template variables can be used. Tips: define the agent's role, set constraints, specify output preferences. |
| **Variables** | Shows all available template variables with syntax: `{{variables.key}}`, `{{prev.output}}`, `{{prev.json.field}}`, `{{steps.name.output}}`, `{{project.name}}`, `{{project.id}}`, `{{now}}`, `{{now.date}}`, `{{now.time}}`, `{{worktree.path}}`, `{{worktree.branch}}`. Explains that variables are resolved at execution time. |
| **Prompt Chain** | Explains the chain concept: steps run sequentially, each step's output is available to the next via `{{prev.output}}`. Different models/efforts per step. Tips: use a fast model for data gathering, a powerful model for analysis. Error handling strategies explained (stop, skip, retry). |

**Full help drawer** (opened via top-level `[? Help]`):

```
┌─────────────────────────────────────────────────────────────────────┐
│  Automations — How It Works                                    [X]  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ## What is an Automation?                                          │
│  An automation runs a chain of LLM prompts on a schedule.           │
│  Each step can use a different model, effort level, and tools.      │
│  The output of one step feeds into the next.                        │
│                                                                     │
│  ## Prompt Chain                                                    │
│  Steps run sequentially. Use {{prev.output}} to pass data           │
│  between steps. Choose "JSON" output format when you need to        │
│  extract specific fields with {{prev.json.fieldName}}.              │
│                                                                     │
│  ## Template Variables                                              │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  {{prev.output}}          Previous step's full response    │     │
│  │  {{prev.json.field}}      JSON field from previous step    │     │
│  │  {{steps.name.output}}    Output from a named step         │     │
│  │  {{variables.key}}        Your custom variables            │     │
│  │  {{project.name}}         Project name                     │     │
│  │  {{project.id}}           Project ID                       │     │
│  │  {{now}}                  Current ISO datetime             │     │
│  │  {{now.date}}             Current date (YYYY-MM-DD)        │     │
│  │  {{now.time}}             Current time (HH:MM:SS)          │     │
│  │  {{worktree.path}}        Worktree directory (if enabled)  │     │
│  │  {{worktree.branch}}      Worktree branch (if enabled)     │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ## Scheduling                                                      │
│  - **Cron**: Repeating schedule using cron syntax                   │
│  - **Once**: Single execution at a specific date/time               │
│  - **Manual**: Only runs when you click "Run Now"                   │
│  Cron quick reference: minute hour day month weekday                │
│  Examples: "0 9 * * 1-5" = weekdays at 9am                         │
│            "*/30 * * * *" = every 30 minutes                        │
│                                                                     │
│  ## Worktrees                                                       │
│  Enable worktree to run the automation in an isolated git           │
│  working copy. The agent can modify files without affecting         │
│  your main checkout. Useful for code generation, refactoring,       │
│  and branch-based analysis. Manage via the Worktrees page.          │
│                                                                     │
│  ## Models & Effort                                                 │
│  Each step can use a different model. Tip: use a fast/cheap         │
│  model for data gathering steps and a powerful model for            │
│  analysis and decision-making steps.                                │
│  Effort: low (fast), medium (balanced), high (thorough).            │
│                                                                     │
│  ## Error Handling                                                  │
│  - **Stop**: Abort the entire chain on error                        │
│  - **Skip**: Mark step as skipped, continue to next                 │
│  - **Retry**: Retry the step (up to N times), then stop             │
│                                                                     │
│  ## Tools                                                           │
│  Each step can access built-in tools (file read, search, shell),    │
│  extension routes (e.g., Jira create ticket), and MCP server        │
│  tools (e.g., GitHub list commits). Select "all" or specific        │
│  extensions/MCPs per step.                                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 10.3 Run History & Log Viewer

```
┌─────────────────────────────────────────────────────────────────────┐
│  Daily Code Review — Run History                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─ Run #47  ─  ✓ Completed  ─  Scheduled  ─  Today 9:00 AM ───┐ │
│  │  Duration: 1m 42s  │  Steps: 3/3  │  Tokens: 12,450          │ │
│  │  Worktree: main @ /tmp/renre-wt/... (cleaned up)              │ │
│  │                                                     [Details] │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ Run #46  ─  ✗ Failed  ─  Manual  ─  Yesterday 3:15 PM ─────┐ │
│  │  Duration: 0m 23s  │  Steps: 1/3 (failed at step 2)          │ │
│  │  Error: "Tool github-mcp/list_commits timed out"              │ │
│  │                                                     [Details] │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 10.4 Run Detail & Debug View

```
┌─────────────────────────────────────────────────────────────────────┐
│  Run #47 — Daily Code Review                                        │
│  Started: 2026-03-09 09:00:00  │  Duration: 1m 42s  │  ✓ Completed │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ── Chain Timeline ────────────────────────────────────────────────  │
│                                                                     │
│  ●━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━●             │
│  Step 1 (18s)     Step 2 (52s)                Step 3 (12s)          │
│  gpt-4o/low       claude-sonnet/high          gpt-4o/low            │
│                                                                     │
│  ── Step 1: Gather Changes ────────────────── ✓ 18s ──────────────  │
│                                                                     │
│  [Prompt]  [Response]  [Tools (3)]  [Debug]                         │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Resolved Prompt:                                            │    │
│  │ "List all commits from yesterday on branch main.            │    │
│  │  For each commit, show the diff and files changed..."       │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │ System Prompt:                                              │    │
│  │ "You are a senior code reviewer for the my-app project..."  │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │ Model: gpt-4o  │  Effort: low  │  Tokens: 1,240 in / 3,100 out │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Tool Calls:                                                        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 1. github-mcp/list_commits  │  MCP  │  ✓  │  2.3s           │   │
│  │    args: { branch: "main", since: "2026-03-08" }             │   │
│  │    result: [{ sha: "abc123", message: "feat: add..." }, ...] │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │ 2. github-mcp/get_diff     │  MCP  │  ✓  │  1.8s            │   │
│  │    args: { sha: "abc123" }                                    │   │
│  │    result: "diff --git a/src/..." (truncated)                 │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │ 3. github-mcp/get_diff     │  MCP  │  ✓  │  1.5s            │   │
│  │    args: { sha: "def456" }                                    │   │
│  │    result: "diff --git a/lib/..." (truncated)                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ── Step 2: Analyze & Review ──────────────── ✓ 52s ──────────────  │
│  ...                                                                │
│                                                                     │
│  ── Step 3: Generate Summary ──────────────── ✓ 12s ──────────────  │
│  ...                                                                │
│                                                                     │
│  ── Final Output ──────────────────────────────────────────────────  │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ ## Daily Code Review - March 9, 2026                        │    │
│  │                                                              │    │
│  │ - **Security**: Fixed XSS vulnerability in user input        │    │
│  │   handler (commit abc123) — JIRA-456 created                 │    │
│  │ - **Performance**: New database query in /api/users adds     │    │
│  │   15ms latency — consider indexing user_email column         │    │
│  │ - **Style**: 3 commits followed naming conventions           │    │
│  │ - **Tests**: 2 new test files added, coverage stable at 84%  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 11. Scheduling Details

#### 11.1 Cron via `node-cron`

```typescript
import cron from "node-cron";

private scheduleAutomation(automation: Automation): void {
  if (automation.schedule.type !== "cron" || !automation.schedule.cron) return;

  const job = cron.schedule(
    automation.schedule.cron,
    async () => {
      // Check date range constraints
      const now = new Date();
      if (automation.schedule.startsAt && now < new Date(automation.schedule.startsAt)) return;
      if (automation.schedule.endsAt && now > new Date(automation.schedule.endsAt)) return;

      await this.executeChain(automation, "scheduled");
    },
    {
      timezone: automation.schedule.timezone,
      scheduled: automation.enabled,
    }
  );

  this.scheduledJobs.set(automation.id, job);
}
```

#### 11.2 One-Time Runs

For `type: "once"`, the engine sets a `setTimeout` to the target datetime. If the worker restarts before the scheduled time, the pending one-time runs are re-evaluated at startup.

#### 11.3 Concurrency Guard

Only **one run per automation** can be active at a time. If a cron fires while the previous run is still executing, the new run is skipped and logged as `{ status: "skipped", reason: "previous_run_active" }`.

### 12. System Prompt Injection

The system prompt for each step is assembled from three layers:

```
1. Project context (assembled by ContextRecipeEngine — ADR-035)
   ├── Session memory, observations, tool rules, extension context
   └── Token budget: proportional to step position (more context for early steps)

2. Automation-level system prompt (user-defined in Console UI)
   └── "You are a senior code reviewer for {{project.name}}..."

3. Chain execution context (auto-injected)
   └── "This is step {n} of {total} in an automated workflow.
        You will receive the output of the previous step as context.
        Respond with {outputFormat}."
```

### 13. Sidebar & Navigation

```
Dashboard
Chat                             ← ADR-047
Automations                      ← NEW (this ADR)
Worktrees                        ← ADR-051
────────────────
Jira (extension pages)
GitHub MCP (extension pages)
────────────────
Extension Manager
Logs
```

The Automations page appears as a core sidebar item between Chat and extension pages.

> **ADR-024 amendment**: The sidebar structure in ADR-024 must be updated to include Chat, Automations, and Worktrees as core pages above the extension separator. Core pages ordering: Dashboard, Chat, Automations, Worktrees.

### 14. Log Retention

| Data | Retention | Cleanup |
|------|-----------|---------|
| Automation definitions | Permanent (until deleted) | User action |
| Run records | 90 days | Daily cleanup job |
| Step logs | 90 days | Cascade with run deletion |
| Tool call logs | 90 days | Cascade with step deletion |
| LLM response text | 30 days (then truncated to first 500 chars) | Daily cleanup job |

Retention is configurable per-project via `~/.renre-kit/config.json`:
```json
{
  "automations": {
    "retentionDays": 90,
    "responseRetentionDays": 30,
    "maxConcurrentRuns": 3
  }
}
```

### 15. Dependencies

| Package | Side | Purpose |
|---------|------|---------|
| `node-cron` | Worker (Node.js) | Cron scheduling (~5KB) |

No new Console UI dependencies — uses existing shadcn/ui components for the chain editor and log viewer.

### 16. Extension Scheduler (Scoped Cron for Extensions)

Extensions can register their own cron jobs through a **scoped scheduler interface** added to `ExtensionContext` (ADR-019). Extension cron jobs are completely isolated from core user automations — extensions cannot see, modify, cancel, or interfere with user-created prompt chains, and vice versa.

#### 16.1 Isolation Model

```
┌──────────────────────────────────────────────────────────┐
│                    AutomationEngine                       │
│                                                          │
│  ┌─────────────────────┐   ┌──────────────────────────┐  │
│  │  Core Automations   │   │  Extension Cron Jobs     │  │
│  │  (user prompt       │   │  (simple callbacks,      │  │
│  │   chains via UI)    │   │   no prompt chains)      │  │
│  │                     │   │                          │  │
│  │  _automations table │   │  _scheduler_jobs table    │  │
│  │  _automation_runs   │   │  _scheduler_runs          │  │
│  │                     │   │                          │  │
│  │  Full CRUD via REST │   │  ScopedScheduler proxy   │  │
│  │  Console UI editor  │   │  per extension           │  │
│  └─────────────────────┘   └──────────────────────────┘  │
│                                                          │
│  Shared: node-cron instance, concurrency limits          │
│  Isolated: data, scheduling, cancellation                │
└──────────────────────────────────────────────────────────┘
```

**What extensions CAN do:**
- Register cron jobs with a callback function
- List/cancel/toggle only their own cron jobs
- Access their own cron job run history

**What extensions CANNOT do:**
- Access `_automations`, `_automation_runs`, or any core automation table
- List, trigger, cancel, or modify other extensions' cron jobs
- Exceed their allocated concurrency or frequency limits
- Register jobs for hook events they don't have permission for

#### 16.2 Extension SDK: `ScopedScheduler` Interface

Added to `ExtensionContext` (ADR-019 amendment):

```typescript
// @renre-kit/extension-sdk — scheduler types

export interface ScopedScheduler {
  /**
   * Register a cron job. Returns the job ID.
   * The callback receives a CronJobContext with the extension's
   * scoped database, logger, MCP client, and config.
   */
  register(opts: CronJobOptions): Promise<string>;

  /** Cancel a cron job by ID. Only jobs owned by this extension. */
  cancel(jobId: string): Promise<void>;

  /** Enable/disable a cron job. Only jobs owned by this extension. */
  toggle(jobId: string, enabled: boolean): Promise<void>;

  /** List all cron jobs registered by this extension. */
  list(): Promise<CronJobInfo[]>;

  /** Get run history for a specific job. */
  runs(jobId: string, opts?: { limit?: number }): Promise<CronJobRun[]>;
}

export interface CronJobOptions {
  name: string;                    // Unique within this extension (e.g., "sync-issues")
  cron: string;                    // Standard cron expression
  timezone?: string;               // IANA timezone (default: system)
  callback: (ctx: CronJobContext) => Promise<void>;
  timeoutMs?: number;              // Per-execution timeout (default: 60000)
  enabled?: boolean;               // Start enabled (default: true)
  description?: string;            // Human-readable description
}

export interface CronJobContext {
  jobId: string;
  projectId: string;
  db: ScopedDatabase | null;       // Same scoped DB as ExtensionContext
  logger: ExtensionLogger;
  config: Record<string, string>;  // Resolved extension settings
  mcp: MCPClient | null;           // Same MCP client as ExtensionContext
  signal: AbortSignal;             // Cancelled when timeout or manual cancel
}

export interface CronJobInfo {
  id: string;
  name: string;
  cron: string;
  timezone?: string;
  enabled: boolean;
  description?: string;
  lastRunAt?: string;
  lastRunStatus?: "completed" | "failed" | "timed_out";
  nextRunAt?: string;
}

export interface CronJobRun {
  id: string;
  jobId: string;
  status: "running" | "completed" | "failed" | "timed_out";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}

// Updated ExtensionContext (amendment to ADR-019)
export interface ExtensionContext {
  projectId: string;
  db: ScopedDatabase | null;
  logger: ExtensionLogger;
  config: Record<string, string>;
  mcp: MCPClient | null;
  scheduler: ScopedScheduler | null;  // null if extension has no `scheduler` permission
}
```

#### 16.3 Scoping Enforcement

The `ScopedScheduler` proxy (analogous to `ScopedDatabase`) enforces isolation at runtime:

1. **Ownership enforcement**: All CRUD operations filter by `extension_name`. An extension calling `cancel(jobId)` where `jobId` belongs to another extension receives a `JobNotFoundError` — it cannot even confirm the job exists.
2. **Name uniqueness**: Job names are scoped to `{extension_name}:{job_name}`. An extension registering `"sync-issues"` internally creates `"jira-plugin:sync-issues"`. No collision with other extensions or core automations.
3. **Table isolation**: Extension cron data lives in `_scheduler_jobs` and `_scheduler_runs` — **core tables** (prefixed with `_`, not `ext_`). They are managed exclusively by the `ScopedScheduler` proxy, never directly by extensions. The `ScopedDatabase` proxy blocks access to all `_`-prefixed tables (including `_scheduler_*`, `_automations`, `_automation_runs`, `_vault`, `_migrations`, etc.), so extensions cannot query cron tables directly — they must use the `ScopedScheduler` API.

   > **ADR-019 amendment**: The `ScopedDatabase` blocked table list must include `_scheduler_jobs`, `_scheduler_runs`, `_automations`, `_automation_runs`, `_automation_step_logs`, and `_automation_tool_calls` alongside existing blocked tables (`_vault`, `_migrations`, `_sessions`, etc.).

4. **Callback isolation**: Extension cron callbacks run inside the same `try/catch` + circuit breaker boundary as extension route handlers (ADR-002). A crashing cron job suspends only that extension's cron jobs, not core automations or other extensions. Cron job failures count toward a **separate** circuit breaker counter from route handler failures — a route crash does not affect cron scheduling and vice versa.
5. **No prompt chain access**: `ScopedScheduler` provides simple callback-based cron — no `PromptStep[]`, no `CopilotBridge` sessions, no chain variables. Extensions that need LLM interaction in cron jobs can call their own MCP tools or extension routes, but they do not get direct access to the prompt chain engine.

#### 16.4 SQLite Schema (Extension Cron)

```sql
-- Extension-registered cron jobs (separate from core _automations)
CREATE TABLE _scheduler_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  extension_name TEXT NOT NULL,
  job_name TEXT NOT NULL,           -- Unique per extension per project
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

CREATE INDEX idx_scheduler_project_ext ON _scheduler_jobs(project_id, extension_name);
CREATE INDEX idx_scheduler_enabled ON _scheduler_jobs(enabled);

-- Extension cron job execution history
CREATE TABLE _scheduler_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES _scheduler_jobs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  extension_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'timed_out')),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  duration_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_scheduler_runs_job ON _scheduler_runs(job_id);
CREATE INDEX idx_scheduler_runs_ext ON _scheduler_runs(project_id, extension_name);
```

#### 16.5 Permission: `scheduler`

New permission type added to the manifest (amendment to ADR-017):

```json
{
  "name": "jira-plugin",
  "permissions": {
    "database": true,
    "network": ["https://api.atlassian.net/*"],
    "hooks": ["sessionStart"],
    "vault": ["JIRA_API_TOKEN"],
    "scheduler": true
  }
}
```

| Permission | Description | Default | Enforcement |
|------------|-------------|---------|-------------|
| `scheduler` | Can register cron jobs via `ScopedScheduler` | `false` | **Enforced** — `null` when not granted |

Extensions without `scheduler: true` receive `null` for `scheduler` in `ExtensionContext`. The installation prompt shows:

```
jira-plugin@2.1.0 requests the following permissions:

  ✓ Database        — create and manage tables (project-scoped)
  ✓ Network         — https://api.atlassian.net/*
  ✓ Hooks           — sessionStart
  ✓ Vault secrets   — JIRA_API_TOKEN
  ✓ Scheduler       — register cron jobs (extension-scoped)

Install? (y/N)
```

> **ADR-017 amendment**: The permission types table must add `scheduler` as a new row:
> | `scheduler` | Can register cron jobs via `ScopedScheduler` | `false` |
>
> Enforcement: **Enforced** — extensions without `scheduler: true` receive `null` for `scheduler` in `ExtensionContext`. Identical to `database` enforcement (gate via null).
>
> **Permission upgrade/downgrade**: If an extension upgrades and **removes** the `scheduler` permission, all existing cron jobs registered by that extension are **paused** (not deleted). They remain in the database but `enabled` is set to `false`. The user sees a notification in the Console UI. If the extension re-adds the permission in a future upgrade, paused jobs are re-enabled.

**Global scheduler limits** apply across all extensions and are configured in `~/.renre-kit/config.json` (see §16.6). These limits are enforced by the `AutomationEngine`, not by individual `ScopedScheduler` instances — so even if an extension has `scheduler: true`, it cannot exceed system-wide limits.

#### 16.6 Frequency & Concurrency Limits

Extensions are rate-limited to prevent resource abuse:

| Limit | Default | Configurable |
|-------|---------|-------------|
| Max cron jobs per extension per project | 10 | `config.json` → `scheduler.maxJobsPerExtension` |
| Minimum cron interval | 1 minute | `config.json` → `scheduler.minIntervalMinutes` |
| Max concurrent executions per extension | 2 | `config.json` → `scheduler.maxConcurrentPerExtension` |
| Max total extension cron executions (all extensions) | 10 | `config.json` → `scheduler.maxConcurrentTotal` |

The `register()` method validates the cron expression against `minIntervalMinutes` and rejects expressions that would fire more frequently. The engine skips a scheduled execution if the extension has hit its concurrency limit.

#### 16.7 Extension Lifecycle Integration

| Event | Behavior |
|-------|----------|
| Extension **mount** | `ScopedScheduler` is created, existing jobs for this extension are loaded and scheduled |
| Extension **unmount** | All cron jobs for this extension are paused (not deleted). Active executions receive `AbortSignal` |
| Extension **uninstall** | All cron jobs and run history for this extension are deleted (`DELETE FROM _scheduler_jobs WHERE extension_name = ?`) |
| Extension **suspend** (circuit breaker) | All cron jobs paused. Re-enabled when circuit breaker resets |
| Worker **shutdown** | All extension cron jobs stopped cleanly |
| Worker **startup** | All enabled extension cron jobs for active projects are re-scheduled |

#### 16.8 Extension Usage Example

```typescript
// extensions/jira-plugin/backend/index.ts
import { ExtensionRouterFactory } from "@renre-kit/extension-sdk";
import { Router } from "express";

const factory: ExtensionRouterFactory = (ctx) => {
  const router = Router();

  // Register a cron job to sync Jira issues every 30 minutes
  ctx.scheduler?.register({
    name: "sync-issues",
    cron: "*/30 * * * *",
    description: "Sync open Jira issues from Atlassian API",
    timeoutMs: 30000,
    callback: async (jobCtx) => {
      jobCtx.logger.info("Starting Jira issue sync");

      const response = await fetch(
        `${jobCtx.config.JIRA_BASE_URL}/rest/api/3/search?jql=status!=Done`,
        { headers: { Authorization: `Bearer ${jobCtx.config.JIRA_API_TOKEN}` }, signal: jobCtx.signal }
      );
      const data = await response.json();

      // Store in extension's scoped database
      for (const issue of data.issues) {
        jobCtx.db!.prepare(
          "INSERT OR REPLACE INTO issues (project_id, key, summary, status) VALUES (?, ?, ?, ?)"
        ).run(jobCtx.projectId, issue.key, issue.fields.summary, issue.fields.status.name);
      }

      jobCtx.logger.info(`Synced ${data.issues.length} issues`);
    },
  });

  // Routes...
  router.get("/issues", (req, res) => { /* ... */ });

  return router;
};

export default factory;
```

#### 16.9 Console UI: Extension Cron Visibility

Extension cron jobs appear in the **Automations page** in a separate "Extension Jobs" section below the user automations, providing visibility without mixing the two:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Automations                                      [+ New Automation]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ── User Automations ──────────────────────────────────────────────  │
│  (user-created prompt chains — full edit/delete control)            │
│  ...                                                                │
│                                                                     │
│  ── Extension Jobs ────────────────────────────────────────────────  │
│  (registered by extensions — view & toggle only)                    │
│                                                                     │
│  ┌─ jira-plugin: sync-issues ───────────────── ON ───────────────┐ │
│  │  ⏰ Every 30 minutes  │  Last: ✓ 12m ago  │  Avg: 4.2s       │ │
│  │  "Sync open Jira issues from Atlassian API"                    │ │
│  │                                               [Pause] [Logs]  │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ slack-notify: digest ───────────────────── ON ───────────────┐ │
│  │  ⏰ Daily at 5:00 PM   │  Last: ✓ 3h ago  │  Avg: 1.8s       │ │
│  │  "Post daily project summary to Slack channel"                 │ │
│  │                                               [Pause] [Logs]  │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Users can **pause/resume** and **view logs** for extension cron jobs, but cannot edit the cron expression or callback — those are owned by the extension code. Uninstalling the extension removes its jobs entirely.

#### 16.10 REST API (Extension Cron)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/{pid}/ext-cron` | GET | List all extension cron jobs for project |
| `/api/{pid}/ext-cron/{jobId}/toggle` | POST | Pause/resume an extension cron job |
| `/api/{pid}/ext-cron/{jobId}/runs` | GET | Get run history for an extension cron job |

No create/update/delete endpoints — extension cron jobs are managed programmatically by extensions via `ScopedScheduler`, not by user REST calls. The REST API is read-only + toggle for the Console UI.

## Consequences

### Positive
- **Automates repetitive LLM workflows** — daily reviews, audits, reports run without manual intervention
- **Prompt chaining** allows complex multi-step workflows with different models optimized per step
- **Full tool access** — automations can use extensions, MCP servers, and built-in tools, just like interactive chat
- **Project-scoped** — each automation inherits the project's context, extensions, and hooks
- **Detailed debug logs** — every prompt, tool call, LLM response, and timing is captured for troubleshooting
- **Visual chain editor** — Console UI makes it clear what each step does, its model/effort, and how data flows
- **Reuses CopilotBridge** — no new LLM integration needed, leverages ADR-047 infrastructure
- **Flexible scheduling** — cron, one-time, manual trigger, date range constraints
- **Extension scheduler is fully isolated** — extensions get scoped cron without any access to core automations; a misbehaving extension cannot break user prompt chains
- **Unified Automations page** — users see both their automations and extension jobs in one place, with clear separation and appropriate controls

### Negative
- **Resource consumption** — scheduled automations consume LLM tokens without human oversight; a misconfigured cron could run frequently
- **Complexity** — prompt chaining with variable substitution adds template parsing logic
- **Log storage** — detailed logs with full LLM responses can grow large; requires retention policies
- **Autopilot mode** — automations auto-approve all permission requests; tool calls (file writes, API calls) happen without per-action approval (user is warned at automation creation)
- **Copilot CLI dependency** — requires Copilot CLI running for LLM access (same as Chat)
- **Extension cron adds surface area** — each extension can register up to 10 cron jobs, increasing background activity

### Mitigations
- **Rate limiting**: `maxConcurrentRuns` config prevents runaway concurrent executions across all automations
- **Concurrency guard**: one active run per automation prevents overlap
- **Chain timeout**: `maxDurationMs` kills long-running automations (default 5 min)
- **Step timeout**: per-step timeout prevents single steps from blocking the chain
- **Log retention**: automatic cleanup prevents unbounded storage growth
- **Manual review**: Run History page with full debug logs lets users audit automation behavior
- **Enable/disable toggle**: quick way to pause automations without deleting them
- **Tool governance**: existing tool governance rules (ADR-029) apply to automation sessions — denied tools are logged
- **Extension cron limits**: max jobs per extension (10), minimum interval (1 min), max concurrent (2 per ext / 10 total) — all configurable
- **Circuit breaker integration**: crashing extension cron jobs trigger the same circuit breaker as route handlers (ADR-002), suspending only that extension's jobs

### Risks
- **Prompt injection via chained outputs**: A malicious LLM response in step N could include template syntax like `{{variables.secret}}` in its output. Mitigated: single-pass template engine (§6.1) — after substitution, no re-evaluation occurs. Output is always injected into user message, never system prompt.
- **Stale context**: Long-running automations may operate on stale project context. Mitigated: context is assembled fresh at each step execution, not cached.
- **Timezone drift**: Cron timezone handling edge cases (DST transitions). Mitigated: `node-cron` handles timezone-aware scheduling via IANA timezone database.
- **Autopilot risk**: Auto-approved tool calls could modify important files or make unintended API calls. Mitigated: tool governance (ADR-029) blocks denied tools before autopilot sees them; all auto-approved actions are logged; user is informed at automation creation.

## Alternatives Considered

1. **External scheduler (cron job calling CLI)** — Rejected: requires CLI + worker coordination, no Console UI integration, no chaining
2. **Single prompt per automation (no chaining)** — Rejected: most useful workflows require multi-step reasoning with different models
3. **DAG-based execution (parallel branches)** — Deferred: linear chains cover 90% of use cases; DAG support can be added later as a non-breaking extension to `PromptStep[]`
4. **Webhook triggers** — Deferred: useful for CI/CD integration but not needed for MVP; can be added alongside cron/manual triggers
5. **Built-in LLM client (no Copilot SDK)** — Rejected: would duplicate ADR-047 infrastructure and require separate API key management

## References

- ADR-002: Extension Lazy Loading & Circuit Breaker (crash isolation for extension cron callbacks)
- ADR-008: Extension MCP Bridge (MCP tool access from automations)
- ADR-017: Extension Permissions — **amended**: adds `scheduler` permission type
- ADR-019: Extension SDK Contract — **amended**: adds `ScopedScheduler` to `ExtensionContext`, adds `_scheduler_*` and `_automation*` to `ScopedDatabase` blocked tables
- ADR-024: Console UI Pages — **amended**: sidebar structure updated with Chat, Automations, Worktrees as core pages
- ADR-029: Tool Governance (tool access rules apply to automation sessions)
- ADR-035: Context Recipes (system prompt assembly with token budgets)
- ADR-047: Console Chat UI with Copilot SDK — **amended**: adds `closeSession()` to CopilotBridge public API
- ADR-048: Socket.IO Real-Time Communication — **amended**: adds `automation:{runId}` room and `automation:*` events
- ADR-051: Worktree Management (isolated git worktrees for automations and user workflows)
- [node-cron](https://github.com/node-cron/node-cron) — cron scheduling for Node.js
