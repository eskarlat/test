import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import type Database from "better-sqlite3";
import cron from "node-cron";
import type { Server } from "socket.io";
import { logger } from "./logger.js";
import { globalPaths } from "./paths.js";
import type { CopilotBridge } from "./copilot-bridge.js";
import type { WorktreeManager, Worktree } from "./worktree-manager.js";
import { resolveTemplate, buildTemplateVars } from "./template-engine.js";
import { assemble as assembleContext } from "./context-recipe-engine.js";
import { getRegistry as getProjectRegistry } from "../routes/projects.js";

// ---------------------------------------------------------------------------
// Types (Task 3.3)
// ---------------------------------------------------------------------------

export type AutomationScheduleType = "cron" | "once" | "manual";
export type AutomationRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "cancelled"
  | "timed_out";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type ErrorStrategy = "stop" | "skip" | "retry";

export interface AutomationSchedule {
  type: AutomationScheduleType;
  cron?: string;
  timezone?: string;
  runAt?: string;
  startsAt?: string;
  endsAt?: string;
}

export interface ToolAccess {
  builtIn: boolean;
  extensions: "all" | string[];
  mcp: "all" | string[];
}

export interface PromptStep {
  id: string;
  name: string;
  prompt: string;
  model: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  tools: ToolAccess;
  maxTokens?: number;
  timeoutMs?: number;
  onError: ErrorStrategy;
  retryCount?: number;
  outputFormat?: "text" | "json";
}

export interface WorktreeConfig {
  enabled: boolean;
  branch?: string;
  cleanup: "always" | "on_success" | "never" | "ttl";
  ttlMs?: number;
}

export interface Automation {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  enabled: boolean;
  schedule: AutomationSchedule;
  chain: PromptStep[];
  systemPrompt?: string;
  variables?: Record<string, string>;
  worktree?: WorktreeConfig;
  maxDurationMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorktreeRunInfo {
  worktreeId: string;
  path: string;
  branch: string;
  status: "active" | "cleaned_up" | "retained";
}

export interface AutomationRun {
  id: string;
  automationId: string;
  projectId: string;
  status: AutomationRunStatus;
  triggerType: "scheduled" | "manual";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  stepCount: number;
  stepsCompleted: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  worktree?: WorktreeRunInfo;
  steps?: StepExecution[];
  createdAt: string;
}

export interface StepExecution {
  id: string;
  runId: string;
  stepIndex: number;
  stepName: string;
  status: StepStatus;
  model?: string;
  reasoningEffort?: string;
  resolvedPrompt?: string;
  systemPrompt?: string;
  response?: string;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  onErrorStrategy?: string;
  timeoutMs?: number;
  toolCalls?: ToolCallLog[];
}

export interface ToolCallLog {
  toolName: string;
  source: "built-in" | "extension" | "mcp";
  extensionName?: string;
  arguments?: string;
  result?: string;
  success: boolean;
  autoApproved?: boolean;
  error?: string;
  startedAt?: string;
  durationMs?: number;
}

export type CreateAutomationInput = Omit<Automation, "id" | "projectId" | "createdAt" | "updatedAt">;
export type UpdateAutomationInput = Partial<Omit<Automation, "id" | "projectId" | "createdAt" | "updatedAt">>;

// ---------------------------------------------------------------------------
// DB Row Types (internal)
// ---------------------------------------------------------------------------

interface AutomationRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  enabled: number;
  schedule_type: string;
  schedule_cron: string | null;
  schedule_timezone: string | null;
  schedule_run_at: string | null;
  schedule_starts_at: string | null;
  schedule_ends_at: string | null;
  chain_json: string;
  system_prompt: string | null;
  variables_json: string | null;
  worktree_json: string | null;
  max_duration_ms: number | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  automation_id: string;
  project_id: string;
  status: string;
  trigger_type: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  step_count: number;
  steps_completed: number;
  total_input_tokens: number;
  total_output_tokens: number;
  worktree_id: string | null;
  worktree_branch: string | null;
  worktree_path: string | null;
  worktree_status: string | null;
  created_at: string;
}

interface StepRow {
  id: string;
  run_id: string;
  step_index: number;
  step_name: string;
  status: string;
  model: string | null;
  reasoning_effort: string | null;
  resolved_prompt: string | null;
  system_prompt: string | null;
  response: string | null;
  input_tokens: number;
  output_tokens: number;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  on_error_strategy: string | null;
  timeout_ms: number | null;
}

interface ToolCallRow {
  id: number;
  step_log_id: string;
  tool_name: string;
  source: string;
  extension_name: string | null;
  arguments_json: string | null;
  result_json: string | null;
  success: number;
  auto_approved: number | null;
  error: string | null;
  started_at: string | null;
  duration_ms: number | null;
}

// ---------------------------------------------------------------------------
// Configuration (Task 3.9)
// ---------------------------------------------------------------------------

interface AutomationConfig {
  retentionDays: number;
  responseRetentionDays: number;
  maxConcurrentRuns: number;
  defaultMaxDurationMs: number;
  defaultStepTimeoutMs: number;
}

const AUTOMATION_DEFAULTS: AutomationConfig = {
  retentionDays: 90,
  responseRetentionDays: 30,
  maxConcurrentRuns: 3,
  defaultMaxDurationMs: 300000,
  defaultStepTimeoutMs: 60000,
};

function loadConfig(): AutomationConfig {
  try {
    const { configFile } = globalPaths();
    if (!existsSync(configFile)) return { ...AUTOMATION_DEFAULTS };
    const raw = readFileSync(configFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const overrides = parsed["automations"] as Partial<AutomationConfig> | undefined;
    if (!overrides || typeof overrides !== "object") return { ...AUTOMATION_DEFAULTS };
    return {
      retentionDays:
        typeof overrides.retentionDays === "number"
          ? overrides.retentionDays
          : AUTOMATION_DEFAULTS.retentionDays,
      responseRetentionDays:
        typeof overrides.responseRetentionDays === "number"
          ? overrides.responseRetentionDays
          : AUTOMATION_DEFAULTS.responseRetentionDays,
      maxConcurrentRuns:
        typeof overrides.maxConcurrentRuns === "number"
          ? overrides.maxConcurrentRuns
          : AUTOMATION_DEFAULTS.maxConcurrentRuns,
      defaultMaxDurationMs:
        typeof overrides.defaultMaxDurationMs === "number"
          ? overrides.defaultMaxDurationMs
          : AUTOMATION_DEFAULTS.defaultMaxDurationMs,
      defaultStepTimeoutMs:
        typeof overrides.defaultStepTimeoutMs === "number"
          ? overrides.defaultStepTimeoutMs
          : AUTOMATION_DEFAULTS.defaultStepTimeoutMs,
    };
  } catch {
    return { ...AUTOMATION_DEFAULTS };
  }
}

// ---------------------------------------------------------------------------
// DB Row Mapping Helpers
// ---------------------------------------------------------------------------

function mapRowToAutomation(row: AutomationRow): Automation {
  const schedule: AutomationSchedule = {
    type: row.schedule_type as AutomationScheduleType,
  };
  if (row.schedule_cron) schedule.cron = row.schedule_cron;
  if (row.schedule_timezone) schedule.timezone = row.schedule_timezone;
  if (row.schedule_run_at) schedule.runAt = row.schedule_run_at;
  if (row.schedule_starts_at) schedule.startsAt = row.schedule_starts_at;
  if (row.schedule_ends_at) schedule.endsAt = row.schedule_ends_at;

  const automation: Automation = {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    enabled: row.enabled === 1,
    schedule,
    chain: JSON.parse(row.chain_json) as PromptStep[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.description !== null) automation.description = row.description;
  if (row.system_prompt !== null) automation.systemPrompt = row.system_prompt;
  if (row.variables_json !== null) {
    automation.variables = JSON.parse(row.variables_json) as Record<string, string>;
  }
  if (row.worktree_json !== null) {
    automation.worktree = JSON.parse(row.worktree_json) as WorktreeConfig;
  }
  if (row.max_duration_ms !== null) automation.maxDurationMs = row.max_duration_ms;

  return automation;
}

function mapRowToRun(row: RunRow): AutomationRun {
  const run: AutomationRun = {
    id: row.id,
    automationId: row.automation_id,
    projectId: row.project_id,
    status: row.status as AutomationRunStatus,
    triggerType: row.trigger_type as "scheduled" | "manual",
    stepCount: row.step_count,
    stepsCompleted: row.steps_completed,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    createdAt: row.created_at,
  };

  if (row.started_at !== null) run.startedAt = row.started_at;
  if (row.completed_at !== null) run.completedAt = row.completed_at;
  if (row.duration_ms !== null) run.durationMs = row.duration_ms;
  if (row.error !== null) run.error = row.error;

  if (row.worktree_id !== null) {
    run.worktree = {
      worktreeId: row.worktree_id,
      path: row.worktree_path ?? "",
      branch: row.worktree_branch ?? "",
      status: (row.worktree_status as WorktreeRunInfo["status"]) ?? "active",
    };
  }

  return run;
}

function mapRowToStep(row: StepRow): StepExecution {
  const step: StepExecution = {
    id: row.id,
    runId: row.run_id,
    stepIndex: row.step_index,
    stepName: row.step_name,
    status: row.status as StepStatus,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
  };

  if (row.model !== null) step.model = row.model;
  if (row.reasoning_effort !== null) step.reasoningEffort = row.reasoning_effort;
  if (row.resolved_prompt !== null) step.resolvedPrompt = row.resolved_prompt;
  if (row.system_prompt !== null) step.systemPrompt = row.system_prompt;
  if (row.response !== null) step.response = row.response;
  if (row.error !== null) step.error = row.error;
  if (row.started_at !== null) step.startedAt = row.started_at;
  if (row.completed_at !== null) step.completedAt = row.completed_at;
  if (row.duration_ms !== null) step.durationMs = row.duration_ms;
  if (row.on_error_strategy !== null) step.onErrorStrategy = row.on_error_strategy;
  if (row.timeout_ms !== null) step.timeoutMs = row.timeout_ms;

  return step;
}

function mapRowToToolCall(row: ToolCallRow): ToolCallLog {
  const call: ToolCallLog = {
    toolName: row.tool_name,
    source: row.source as ToolCallLog["source"],
    success: row.success === 1,
  };

  if (row.extension_name !== null) call.extensionName = row.extension_name;
  if (row.arguments_json !== null) call.arguments = row.arguments_json;
  if (row.result_json !== null) call.result = row.result_json;
  if (row.auto_approved !== null) call.autoApproved = row.auto_approved === 1;
  if (row.error !== null) call.error = row.error;
  if (row.started_at !== null) call.startedAt = row.started_at;
  if (row.duration_ms !== null) call.durationMs = row.duration_ms;

  return call;
}

// ---------------------------------------------------------------------------
// AutomationEngine Class (Tasks 3.5-3.8)
// ---------------------------------------------------------------------------

export class AutomationEngine {
  private readonly db: Database.Database;
  private readonly io: Server;
  private readonly scheduledJobs: Map<string, cron.ScheduledTask> = new Map();
  private readonly activeRuns: Map<string, AbortController> = new Map();
  private readonly pendingTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly config: AutomationConfig;

  private copilotBridge: CopilotBridge | null = null;
  private worktreeManager: WorktreeManager | null = null;
  private logCleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(db: Database.Database, io: Server) {
    this.db = db;
    this.io = io;
    this.config = loadConfig();
  }

  setCopilotBridge(bridge: CopilotBridge): void {
    this.copilotBridge = bridge;
  }

  setWorktreeManager(manager: WorktreeManager): void {
    this.worktreeManager = manager;
  }

  // -------------------------------------------------------------------------
  // CRUD Operations (Task 3.5)
  // -------------------------------------------------------------------------

  createAutomation(projectId: string, input: CreateAutomationInput): Automation {
    const id = randomUUID();
    const now = new Date().toISOString();

    // Validate cron expression if schedule type is cron
    if (input.schedule.type === "cron") {
      if (!input.schedule.cron) {
        throw new Error("Cron expression is required for schedule type 'cron'");
      }
      if (!cron.validate(input.schedule.cron)) {
        throw new Error(`Invalid cron expression: ${input.schedule.cron}`);
      }
    }

    // Validate once schedule
    if (input.schedule.type === "once" && !input.schedule.runAt) {
      throw new Error("runAt is required for schedule type 'once'");
    }

    const chainJson = JSON.stringify(input.chain);
    const variablesJson = input.variables ? JSON.stringify(input.variables) : null;
    const worktreeJson = input.worktree ? JSON.stringify(input.worktree) : null;

    this.db
      .prepare(
        `INSERT INTO _automations (
          id, project_id, name, description, enabled,
          schedule_type, schedule_cron, schedule_timezone, schedule_run_at,
          schedule_starts_at, schedule_ends_at,
          chain_json, system_prompt, variables_json, worktree_json,
          max_duration_ms, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        input.name,
        input.description ?? null,
        input.enabled ? 1 : 0,
        input.schedule.type,
        input.schedule.cron ?? null,
        input.schedule.timezone ?? null,
        input.schedule.runAt ?? null,
        input.schedule.startsAt ?? null,
        input.schedule.endsAt ?? null,
        chainJson,
        input.systemPrompt ?? null,
        variablesJson,
        worktreeJson,
        input.maxDurationMs ?? this.config.defaultMaxDurationMs,
        now,
        now,
      );

    const automation = this.getAutomation(id);
    if (!automation) {
      throw new Error("Failed to create automation");
    }

    // Schedule if enabled
    if (automation.enabled) {
      if (automation.schedule.type === "cron") {
        this.scheduleAutomation(automation);
      } else if (automation.schedule.type === "once") {
        this.scheduleOnce(automation);
      }
    }

    logger.info("automations", `Created automation '${automation.name}'`, {
      id: automation.id,
      projectId,
      scheduleType: automation.schedule.type,
    });

    return automation;
  }

  updateAutomation(id: string, updates: UpdateAutomationInput): Automation {
    const existing = this.getAutomation(id);
    if (!existing) {
      throw new Error(`Automation not found: ${id}`);
    }

    const now = new Date().toISOString();
    const setClauses: string[] = ["updated_at = ?"];
    const values: unknown[] = [now];

    if (updates.name !== undefined) {
      setClauses.push("name = ?");
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push("description = ?");
      values.push(updates.description);
    }
    if (updates.enabled !== undefined) {
      setClauses.push("enabled = ?");
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.schedule !== undefined) {
      if (updates.schedule.type === "cron") {
        if (!updates.schedule.cron) {
          throw new Error("Cron expression is required for schedule type 'cron'");
        }
        if (!cron.validate(updates.schedule.cron)) {
          throw new Error(`Invalid cron expression: ${updates.schedule.cron}`);
        }
      }
      if (updates.schedule.type === "once" && !updates.schedule.runAt) {
        throw new Error("runAt is required for schedule type 'once'");
      }
      setClauses.push("schedule_type = ?");
      values.push(updates.schedule.type);
      setClauses.push("schedule_cron = ?");
      values.push(updates.schedule.cron ?? null);
      setClauses.push("schedule_timezone = ?");
      values.push(updates.schedule.timezone ?? null);
      setClauses.push("schedule_run_at = ?");
      values.push(updates.schedule.runAt ?? null);
      setClauses.push("schedule_starts_at = ?");
      values.push(updates.schedule.startsAt ?? null);
      setClauses.push("schedule_ends_at = ?");
      values.push(updates.schedule.endsAt ?? null);
    }
    if (updates.chain !== undefined) {
      setClauses.push("chain_json = ?");
      values.push(JSON.stringify(updates.chain));
    }
    if (updates.systemPrompt !== undefined) {
      setClauses.push("system_prompt = ?");
      values.push(updates.systemPrompt);
    }
    if (updates.variables !== undefined) {
      setClauses.push("variables_json = ?");
      values.push(JSON.stringify(updates.variables));
    }
    if (updates.worktree !== undefined) {
      setClauses.push("worktree_json = ?");
      values.push(JSON.stringify(updates.worktree));
    }
    if (updates.maxDurationMs !== undefined) {
      setClauses.push("max_duration_ms = ?");
      values.push(updates.maxDurationMs);
    }

    values.push(id);
    this.db
      .prepare(`UPDATE _automations SET ${setClauses.join(", ")} WHERE id = ?`)
      .run(...values);

    // Reschedule if schedule or enabled changed
    const scheduleChanged = updates.schedule !== undefined;
    const enabledChanged = updates.enabled !== undefined;
    if (scheduleChanged || enabledChanged) {
      this.unscheduleAutomation(id);
      const updated = this.getAutomation(id);
      if (updated && updated.enabled) {
        if (updated.schedule.type === "cron") {
          this.scheduleAutomation(updated);
        } else if (updated.schedule.type === "once") {
          this.scheduleOnce(updated);
        }
      }
    }

    const result = this.getAutomation(id);
    if (!result) {
      throw new Error(`Automation not found after update: ${id}`);
    }

    logger.info("automations", `Updated automation '${result.name}'`, { id });

    return result;
  }

  deleteAutomation(id: string): void {
    // Unschedule if scheduled
    this.unscheduleAutomation(id);

    // Cancel any active run for this automation
    for (const [runId, controller] of this.activeRuns.entries()) {
      // Look up which automation owns this run
      const runRow = this.db
        .prepare("SELECT automation_id FROM _automation_runs WHERE id = ?")
        .get(runId) as { automation_id: string } | undefined;
      if (runRow && runRow.automation_id === id) {
        controller.abort();
        this.activeRuns.delete(runId);
      }
    }

    // DELETE cascades to runs/step_logs/tool_calls
    this.db.prepare("DELETE FROM _automations WHERE id = ?").run(id);

    logger.info("automations", `Deleted automation`, { id });
  }

  getAutomation(id: string): Automation | null {
    const row = this.db
      .prepare("SELECT * FROM _automations WHERE id = ?")
      .get(id) as AutomationRow | undefined;
    if (!row) return null;
    return mapRowToAutomation(row);
  }

  listAutomations(projectId: string): Automation[] {
    const rows = this.db
      .prepare("SELECT * FROM _automations WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as AutomationRow[];
    return rows.map(mapRowToAutomation);
  }

  toggleAutomation(id: string, enabled: boolean): void {
    const automation = this.getAutomation(id);
    if (!automation) {
      throw new Error(`Automation not found: ${id}`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE _automations SET enabled = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, now, id);

    if (enabled) {
      const updated = this.getAutomation(id);
      if (updated) {
        if (updated.schedule.type === "cron") {
          this.scheduleAutomation(updated);
        } else if (updated.schedule.type === "once") {
          this.scheduleOnce(updated);
        }
      }
    } else {
      this.unscheduleAutomation(id);
      // Cancel active runs when disabling
      for (const [runId, controller] of this.activeRuns.entries()) {
        const runRow = this.db
          .prepare("SELECT automation_id FROM _automation_runs WHERE id = ?")
          .get(runId) as { automation_id: string } | undefined;
        if (runRow && runRow.automation_id === id) {
          controller.abort();
          this.activeRuns.delete(runId);
        }
      }
    }

    logger.info("automations", `${enabled ? "Enabled" : "Disabled"} automation`, { id });
  }

  // -------------------------------------------------------------------------
  // Scheduling (Task 3.6)
  // -------------------------------------------------------------------------

  private scheduleAutomation(automation: Automation): void {
    if (automation.schedule.type !== "cron" || !automation.schedule.cron) return;

    // Unschedule any existing task for this automation
    this.unscheduleAutomation(automation.id);

    const task = cron.schedule(
      automation.schedule.cron,
      () => {
        // Check date range constraints
        const now = new Date();
        if (automation.schedule.startsAt) {
          const startsAt = new Date(automation.schedule.startsAt);
          if (now < startsAt) {
            logger.debug("automations", `Skipping scheduled run: before startsAt`, {
              id: automation.id,
              startsAt: automation.schedule.startsAt,
            });
            return;
          }
        }
        if (automation.schedule.endsAt) {
          const endsAt = new Date(automation.schedule.endsAt);
          if (now > endsAt) {
            logger.info("automations", `Automation past endsAt, unscheduling`, {
              id: automation.id,
              endsAt: automation.schedule.endsAt,
            });
            this.unscheduleAutomation(automation.id);
            return;
          }
        }

        // Concurrency guard
        if (this.isAutomationRunning(automation.id)) {
          logger.warn("automations", `Skipping scheduled run: previous run active`, {
            id: automation.id,
            status: "skipped",
            reason: "previous_run_active",
          });
          return;
        }

        this.executeChain(automation, "scheduled").catch(() => { /* handled internally */ });
      },
      automation.schedule.timezone
        ? { timezone: automation.schedule.timezone }
        : {},
    );

    this.scheduledJobs.set(automation.id, task);
    logger.debug("automations", `Scheduled cron automation`, {
      id: automation.id,
      cron: automation.schedule.cron,
      timezone: automation.schedule.timezone,
    });
  }

  private unscheduleAutomation(automationId: string): void {
    const task = this.scheduledJobs.get(automationId);
    if (task) {
      task.stop();
      this.scheduledJobs.delete(automationId);
      logger.debug("automations", `Unscheduled automation`, { id: automationId });
    }

    // Also clear any pending one-time timeout
    const timeout = this.pendingTimeouts.get(automationId);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingTimeouts.delete(automationId);
    }
  }

  private scheduleOnce(automation: Automation): void {
    if (automation.schedule.type !== "once" || !automation.schedule.runAt) return;

    const runAt = new Date(automation.schedule.runAt);
    const now = new Date();
    const delayMs = runAt.getTime() - now.getTime();

    if (delayMs <= 0) {
      logger.warn("automations", `One-time automation runAt is in the past, skipping`, {
        id: automation.id,
        runAt: automation.schedule.runAt,
      });
      return;
    }

    // Clear any existing timeout for this automation
    const existingTimeout = this.pendingTimeouts.get(automation.id);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      this.pendingTimeouts.delete(automation.id);

      // Concurrency guard
      if (this.isAutomationRunning(automation.id)) {
        logger.warn("automations", `Skipping one-time run: previous run active`, {
          id: automation.id,
          status: "skipped",
          reason: "previous_run_active",
        });
        return;
      }

      this.executeChain(automation, "scheduled").then(() => {
        // Auto-disable after firing
        try {
          this.db
            .prepare("UPDATE _automations SET enabled = 0, updated_at = ? WHERE id = ?")
            .run(new Date().toISOString(), automation.id);
          logger.info("automations", `One-time automation fired and disabled`, {
            id: automation.id,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("automations", `Failed to disable one-time automation: ${msg}`, {
            id: automation.id,
          });
        }
      }).catch(() => { /* handled internally */ });
    }, delayMs);

    this.pendingTimeouts.set(automation.id, timeout);
    logger.debug("automations", `Scheduled one-time automation`, {
      id: automation.id,
      runAt: automation.schedule.runAt,
      delayMs,
    });
  }

  private isAutomationRunning(automationId: string): boolean {
    for (const [runId] of this.activeRuns.entries()) {
      const runRow = this.db
        .prepare("SELECT automation_id FROM _automation_runs WHERE id = ? AND status = 'running'")
        .get(runId) as { automation_id: string } | undefined;
      if (runRow && runRow.automation_id === automationId) {
        return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Startup Reconciliation (Task 3.7)
  // -------------------------------------------------------------------------

  start(): void {
    logger.info("automations", "Starting AutomationEngine...");

    // 1. Mark all running runs as failed (worker restarted during execution)
    const runningRuns = this.db
      .prepare("SELECT id FROM _automation_runs WHERE status = 'running'")
      .all() as Array<{ id: string }>;

    if (runningRuns.length > 0) {
      const now = new Date().toISOString();
      const stmt = this.db.prepare(
        "UPDATE _automation_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?",
      );
      for (const run of runningRuns) {
        stmt.run("Worker restarted during execution", now, run.id);
      }
      logger.warn("automations", `Marked ${runningRuns.length} running run(s) as failed`, {
        runIds: runningRuns.map((r) => r.id),
      });
    }

    // 2. Re-evaluate pending one-time runs
    const pendingOnceAutomations = this.db
      .prepare(
        `SELECT * FROM _automations
         WHERE schedule_type = 'once'
           AND enabled = 1
           AND schedule_run_at > ?`,
      )
      .all(new Date().toISOString()) as AutomationRow[];

    for (const row of pendingOnceAutomations) {
      const automation = mapRowToAutomation(row);
      this.scheduleOnce(automation);
    }

    if (pendingOnceAutomations.length > 0) {
      logger.info("automations", `Re-scheduled ${pendingOnceAutomations.length} pending one-time automation(s)`);
    }

    // 3. Schedule all enabled cron automations
    const cronAutomations = this.db
      .prepare(
        "SELECT * FROM _automations WHERE schedule_type = 'cron' AND enabled = 1",
      )
      .all() as AutomationRow[];

    for (const row of cronAutomations) {
      const automation = mapRowToAutomation(row);
      this.scheduleAutomation(automation);
    }

    if (cronAutomations.length > 0) {
      logger.info("automations", `Scheduled ${cronAutomations.length} cron automation(s)`);
    }

    // 4. Extension cron jobs are managed by individual ScopedScheduler instances
    // wired in extension-loader.ts via loadAndSchedule() at mount time

    // 5. Schedule daily log cleanup
    this.logCleanupTimer = setInterval(() => {
      try {
        this.runLogCleanup();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("automations", `Log cleanup failed: ${msg}`);
      }
    }, 24 * 60 * 60 * 1000);
    this.logCleanupTimer.unref();

    logger.info("automations", "AutomationEngine started", {
      failedReconciled: runningRuns.length,
      cronScheduled: cronAutomations.length,
      onceScheduled: pendingOnceAutomations.length,
    });
  }

  stop(): void {
    logger.info("automations", "Stopping AutomationEngine...");

    // Stop log cleanup timer
    if (this.logCleanupTimer) {
      clearInterval(this.logCleanupTimer);
      this.logCleanupTimer = null;
    }

    // Stop all scheduled cron tasks
    for (const [id, task] of this.scheduledJobs.entries()) {
      task.stop();
      logger.debug("automations", `Stopped cron task`, { id });
    }
    this.scheduledJobs.clear();

    // Cancel all active runs via AbortController
    for (const [runId, controller] of this.activeRuns.entries()) {
      controller.abort();
      logger.debug("automations", `Cancelled active run`, { runId });
    }
    this.activeRuns.clear();

    // Clear all pending timeouts
    for (const [id, timeout] of this.pendingTimeouts.entries()) {
      clearTimeout(timeout);
      logger.debug("automations", `Cleared pending timeout`, { id });
    }
    this.pendingTimeouts.clear();

    logger.info("automations", "AutomationEngine stopped");
  }

  // -------------------------------------------------------------------------
  // Log Retention & Cleanup (Task 5.3)
  // -------------------------------------------------------------------------

  runLogCleanup(retentionDays = 90, responseRetentionDays = 30): void {
    // Delete old runs (cascades to step logs and tool calls via FK)
    this.db
      .prepare(
        `DELETE FROM _automation_runs
         WHERE created_at < datetime('now', '-' || ? || ' days')`,
      )
      .run(retentionDays);

    // Truncate old responses
    this.db
      .prepare(
        `UPDATE _automation_step_logs
         SET response = substr(response, 1, 500) || '... [truncated]'
         WHERE run_id IN (
           SELECT id FROM _automation_runs
           WHERE created_at < datetime('now', '-' || ? || ' days')
         ) AND length(response) > 500`,
      )
      .run(responseRetentionDays);

    // Clean up extension cron run history (_scheduler_runs is Phase 6)
    try {
      this.db
        .prepare(
          `DELETE FROM _scheduler_runs
           WHERE created_at < datetime('now', '-90 days')`,
        )
        .run();
    } catch {
      // _scheduler_runs table may not exist yet (Phase 6)
    }

    logger.info("automations", "Log cleanup completed");
  }

  // -------------------------------------------------------------------------
  // Run Management (Task 3.8)
  // -------------------------------------------------------------------------

  triggerRun(automationId: string): string {
    const automation = this.getAutomation(automationId);
    if (!automation) {
      throw new Error(`Automation not found: ${automationId}`);
    }

    // Concurrency guard
    if (this.isAutomationRunning(automationId)) {
      throw new Error(`Automation '${automation.name}' already has an active run`);
    }

    const runId = randomUUID();

    // Start execution asynchronously
    this.executeChain(automation, "manual", runId).catch(() => { /* handled internally */ });

    return runId;
  }

  cancelRun(runId: string): void {
    const controller = this.activeRuns.get(runId);
    if (!controller) {
      throw new Error(`No active run found: ${runId}`);
    }
    controller.abort();
    // The executeChain method will handle the aborted signal and update the DB
    logger.info("automations", `Cancellation requested for run`, { runId });
  }

  listRuns(
    automationId: string,
    opts?: { status?: AutomationRunStatus; limit?: number },
  ): AutomationRun[] {
    let sql = "SELECT * FROM _automation_runs WHERE automation_id = ?";
    const params: unknown[] = [automationId];

    if (opts?.status) {
      sql += " AND status = ?";
      params.push(opts.status);
    }

    sql += " ORDER BY created_at DESC";

    if (opts?.limit) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as RunRow[];
    return rows.map(mapRowToRun);
  }

  getRunDetails(runId: string): AutomationRun | null {
    // Get the run
    const runRow = this.db
      .prepare("SELECT * FROM _automation_runs WHERE id = ?")
      .get(runId) as RunRow | undefined;
    if (!runRow) return null;

    const run = mapRowToRun(runRow);

    // Get step logs
    const stepRows = this.db
      .prepare(
        "SELECT * FROM _automation_step_logs WHERE run_id = ? ORDER BY step_index ASC",
      )
      .all(runId) as StepRow[];

    // Get tool calls for each step
    const steps: StepExecution[] = stepRows.map((stepRow) => {
      const step = mapRowToStep(stepRow);

      const toolCallRows = this.db
        .prepare(
          "SELECT * FROM _automation_tool_calls WHERE step_log_id = ? ORDER BY id ASC",
        )
        .all(stepRow.id) as ToolCallRow[];

      step.toolCalls = toolCallRows.map(mapRowToToolCall);

      return step;
    });

    run.steps = steps;
    return run;
  }

  // -------------------------------------------------------------------------
  // Chain Execution (Phase 4)
  // -------------------------------------------------------------------------

  private async executeChain(
    automation: Automation,
    triggerType: "scheduled" | "manual",
    runId?: string,
  ): Promise<string> {
    const id = runId ?? randomUUID();
    const startedAt = new Date().toISOString();
    const abortController = new AbortController();
    let chainTimeout: NodeJS.Timeout | null = null;

    // Step a — Global concurrency check
    if (this.activeRuns.size >= this.config.maxConcurrentRuns) {
      logger.warn("automations", `Too many concurrent runs (${this.activeRuns.size}/${this.config.maxConcurrentRuns})`);
      throw new Error("Too many concurrent runs");
    }

    this.activeRuns.set(id, abortController);

    let worktree: Worktree | null = null;
    let hasWarnings = false;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let stepsCompleted = 0;
    const stepOutputs = new Map<string, string>();

    try {
      // Create run record
      this.db
        .prepare(
          `INSERT INTO _automation_runs (
            id, automation_id, project_id, status, trigger_type,
            started_at, step_count, steps_completed,
            total_input_tokens, total_output_tokens, created_at
          ) VALUES (?, ?, ?, 'running', ?, ?, ?, 0, 0, 0, ?)`,
        )
        .run(id, automation.id, automation.projectId, triggerType, startedAt,
          automation.chain.length, startedAt);

      // Set up chain timeout
      const maxDuration = automation.maxDurationMs ?? this.config.defaultMaxDurationMs;
      chainTimeout = setTimeout(() => abortController.abort("timeout"), maxDuration);

      // Step b — Worktree setup
      let executionCwd: string | undefined;
      if (automation.worktree?.enabled && this.worktreeManager) {
        const targetBranch = automation.worktree.branch ?? "HEAD";

        worktree = await this.worktreeManager.create({
          projectId: automation.projectId,
          branch: targetBranch,
          createBranch: true,
          baseBranch: targetBranch,
          cleanupPolicy: automation.worktree.cleanup,
          ...(automation.worktree.ttlMs ? { ttlMs: automation.worktree.ttlMs } : {}),
          createdBy: {
            type: "automation",
            automationId: automation.id,
            automationRunId: id,
          },
        });

        executionCwd = worktree.path;
        await this.worktreeManager.markInUse(worktree.id);

        // Record worktree in run
        this.db.prepare(
          `UPDATE _automation_runs SET worktree_id = ?, worktree_branch = ?, worktree_path = ?, worktree_status = 'active' WHERE id = ?`,
        ).run(worktree.id, worktree.branch, worktree.path, id);
      } else if (!executionCwd) {
        const project = getProjectRegistry().get(automation.projectId);
        executionCwd = project?.path;
      }

      // Step c — Emit run started
      this.io.to(`project:${automation.projectId}`).emit("automation:run-started", {
        runId: id, automationId: automation.id, automationName: automation.name,
        projectId: automation.projectId, trigger: triggerType,
        ...(worktree ? { worktreePath: worktree.path } : {}),
      });

      // Emit log: chain started
      this.emitLog(id, "info", "Chain execution started");

      // Step d — Execute steps sequentially

      for (let stepIndex = 0; stepIndex < automation.chain.length; stepIndex++) {
        // 4a — Check abort
        if (abortController.signal.aborted) break;

        const step = automation.chain[stepIndex]!;
        const stepLogId = randomUUID();
        const stepStartedAt = new Date().toISOString();

        // 4b — Create step record
        this.db.prepare(
          `INSERT INTO _automation_step_logs (
            id, run_id, step_index, step_name, status, model, reasoning_effort,
            on_error_strategy, timeout_ms, started_at
          ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
        ).run(stepLogId, id, stepIndex, step.name, step.model,
          step.reasoningEffort ?? null, step.onError, step.timeoutMs ?? null, stepStartedAt);

        // 4c — Emit step started
        this.io.to(`automation:${id}`).emit("automation:step-started", {
          runId: id, stepId: stepLogId, stepIndex, stepName: step.name, model: step.model,
        });
        this.emitLog(id, "info", "Starting step " + (stepIndex + 1) + ": " + step.name);

        let retries = 0;
        const maxRetries = step.onError === "retry" ? (step.retryCount ?? 2) : 0;
        let stepSuccess = false;

        while (retries <= maxRetries && !stepSuccess) {
          try {
            // 4d — Resolve prompt template
            const project = getProjectRegistry().get(automation.projectId);
            const stepNames = automation.chain.map((s) => s.name);
            const templateVars = buildTemplateVars(
              automation, stepIndex, stepOutputs, stepNames,
              project ? { id: project.id, name: project.name } : { id: automation.projectId, name: "Unknown" },
              worktree ? { path: worktree.path, branch: worktree.branch } : undefined,
            );
            const resolvedPrompt = resolveTemplate(step.prompt, templateVars);

            // Update step with resolved prompt
            this.db.prepare(
              "UPDATE _automation_step_logs SET resolved_prompt = ? WHERE id = ?",
            ).run(resolvedPrompt, stepLogId);

            // 4e — Assemble system prompt (3-layer)
            const systemPrompt = await this.assembleStepSystemPrompt(
              automation, step, stepIndex, executionCwd,
            );

            this.db.prepare(
              "UPDATE _automation_step_logs SET system_prompt = ? WHERE id = ?",
            ).run(systemPrompt, stepLogId);

            // Create ephemeral Copilot session
            if (!this.copilotBridge) {
              throw new Error("CopilotBridge not configured");
            }

            const sessionId = await this.copilotBridge.createChatSession({
              projectId: automation.projectId,
              ...(step.model ? { model: step.model } : {}),
              ...(step.reasoningEffort ? { reasoningEffort: step.reasoningEffort } : {}),
              title: `Automation: ${automation.name} - Step ${stepIndex + 1}: ${step.name}`,
            });

            try {
              // 4f — Send prompt & collect response
              const stepTimeoutMs = step.timeoutMs ?? this.config.defaultStepTimeoutMs;
              const stepAbort = new AbortController();
              const stepTimer = setTimeout(() => stepAbort.abort("step_timeout"), stepTimeoutMs);

              // Register session event listener to forward streaming events
              // to the automation room (message-delta, tool-called)
              const toolCallTracker = new Map<string, { toolName: string; startedAt: string }>();
              const sessionEventListener = (event: string, data: Record<string, unknown>): void => {
                if (event === "message-delta") {
                  this.io.to(`automation:${id}`).emit("automation:message-delta", {
                    runId: id,
                    stepId: stepLogId,
                    deltaContent: String(data["delta"] ?? ""),
                  });
                } else if (event === "tool-start") {
                  const tcId = String(data["toolCallId"] ?? "");
                  const toolName = String(data["toolName"] ?? "unknown");
                  toolCallTracker.set(tcId, { toolName, startedAt: new Date().toISOString() });
                } else if (event === "tool-complete") {
                  const tcId = String(data["toolCallId"] ?? "");
                  const toolName = String(data["toolName"] ?? "unknown");
                  const tracked = toolCallTracker.get(tcId);
                  const startTime = tracked ? new Date(tracked.startedAt).getTime() : Date.now();
                  const dMs = Date.now() - startTime;
                  const tcSuccess = data["error"] === undefined || data["error"] === null;
                  const tcSource = String(data["source"] ?? "built-in");
                  const tcAutoApproved = data["autoApproved"] !== undefined
                    ? Boolean(data["autoApproved"])
                    : undefined;

                  // Emit automation:tool-called event
                  this.io.to(`automation:${id}`).emit("automation:tool-called", {
                    runId: id,
                    stepId: stepLogId,
                    toolName: tracked?.toolName ?? toolName,
                    source: tcSource,
                    durationMs: dMs,
                    success: tcSuccess,
                    ...(tcAutoApproved !== undefined ? { autoApproved: tcAutoApproved } : {}),
                  });

                  // Record tool call to DB
                  let autoApprovedValue: number | null = null;
                  if (tcAutoApproved !== undefined) {
                    autoApprovedValue = tcAutoApproved ? 1 : 0;
                  }
                  this.db.prepare(
                    `INSERT INTO _automation_tool_calls (step_log_id, tool_name, source, success, auto_approved, started_at, duration_ms)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                  ).run(
                    stepLogId,
                    tracked?.toolName ?? toolName,
                    tcSource,
                    tcSuccess ? 1 : 0,
                    autoApprovedValue,
                    tracked?.startedAt ?? new Date().toISOString(),
                    dMs,
                  );

                  toolCallTracker.delete(tcId);
                }
              };

              this.copilotBridge.addSessionEventListener(sessionId, sessionEventListener);

              try {
                // Send message (this blocks until response is complete)
                await Promise.race([
                  this.copilotBridge.sendMessage(sessionId, resolvedPrompt),
                  new Promise<never>((_, reject) => {
                    stepAbort.signal.addEventListener("abort", () => {
                      reject(new Error("Step timed out after " + stepTimeoutMs + "ms"));
                    });
                    abortController.signal.addEventListener("abort", () => {
                      reject(new Error("Chain cancelled"));
                    });
                  }),
                ]);
              } finally {
                // Always unregister the listener
                this.copilotBridge.removeSessionEventListener(sessionId, sessionEventListener);
              }

              clearTimeout(stepTimer);

              // Extract response from session events
              const events = await this.copilotBridge.getSessionMessages(sessionId);
              const responseText = extractResponseText(events);
              const tokens = extractTokenUsage(events);

              totalInputTokens += tokens.input;
              totalOutputTokens += tokens.output;

              // 4g — Close ephemeral session
              await this.copilotBridge.closeSession(sessionId);

              // 4h — Update step record
              const stepCompletedAt = new Date().toISOString();
              const stepDurationMs = new Date(stepCompletedAt).getTime() - new Date(stepStartedAt).getTime();

              this.db.prepare(
                `UPDATE _automation_step_logs SET
                  status = 'completed', response = ?, input_tokens = ?, output_tokens = ?,
                  completed_at = ?, duration_ms = ?
                WHERE id = ?`,
              ).run(responseText, tokens.input, tokens.output, stepCompletedAt, stepDurationMs, stepLogId);

              // Store output for next step piping
              stepOutputs.set(step.name, responseText);
              stepsCompleted++;
              stepSuccess = true;

              // 4i — Emit step completed
              this.io.to(`automation:${id}`).emit("automation:step-completed", {
                runId: id, stepId: stepLogId, stepIndex,
                status: "completed", durationMs: stepDurationMs,
                outputPreview: responseText.slice(0, 200),
              });
              this.emitLog(id, "info", "Step " + step.name + " completed in " + stepDurationMs + "ms");
            } catch (innerErr) {
              // Close session on error
              await this.copilotBridge.closeSession(sessionId).catch(() => {});
              throw innerErr;
            }
          } catch (stepErr) {
            const errMsg = stepErr instanceof Error ? stepErr.message : String(stepErr);

            // Check for chain-level abort
            if (abortController.signal.aborted) {
              this.db.prepare(
                "UPDATE _automation_step_logs SET status = 'failed', error = ? WHERE id = ?",
              ).run("Chain aborted", stepLogId);
              break;
            }

            // Retry logic
            if (retries < maxRetries) {
              retries++;
              logger.warn("automations", `Step ${step.name} failed (retry ${retries}/${maxRetries}): ${errMsg}`, { runId: id });
              continue;
            }

            // 4k — Handle step error
            const stepCompletedAt = new Date().toISOString();
            const stepDurationMs = new Date(stepCompletedAt).getTime() - new Date(stepStartedAt).getTime();

            this.io.to(`automation:${id}`).emit("automation:step-failed", {
              runId: id, stepId: stepLogId, stepIndex, error: errMsg,
            });
            this.emitLog(id, "error", "Step " + step.name + " failed: " + errMsg);

            if (step.onError === "stop") {
              this.db.prepare(
                `UPDATE _automation_step_logs SET status = 'failed', error = ?, completed_at = ?, duration_ms = ? WHERE id = ?`,
              ).run(errMsg, stepCompletedAt, stepDurationMs, stepLogId);

              // Mark remaining steps as skipped
              for (let j = stepIndex + 1; j < automation.chain.length; j++) {
                const skipId = randomUUID();
                this.db.prepare(
                  `INSERT INTO _automation_step_logs (id, run_id, step_index, step_name, status, model, on_error_strategy)
                   VALUES (?, ?, ?, ?, 'skipped', ?, ?)`,
                ).run(skipId, id, j, automation.chain[j]!.name, automation.chain[j]!.model, automation.chain[j]!.onError);
              }

              throw new Error(`Step "${step.name}" failed: ${errMsg}`);
            }

            if (step.onError === "skip") {
              this.db.prepare(
                `UPDATE _automation_step_logs SET status = 'skipped', error = ?, completed_at = ?, duration_ms = ? WHERE id = ?`,
              ).run(errMsg, stepCompletedAt, stepDurationMs, stepLogId);
              hasWarnings = true;
              stepSuccess = true; // Allow loop to continue
            }

            break; // Exit retry loop
          }
        }

        if (abortController.signal.aborted) break;
      }

      // Step e — Finalize run status
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      let finalStatus: AutomationRunStatus;

      if (abortController.signal.aborted) {
        const reason = (abortController.signal as { reason?: string }).reason;
        finalStatus = reason === "timeout" ? "timed_out" : "cancelled";
        if (finalStatus === "timed_out") {
          this.emitLog(id, "warn", "Chain timed out");
        } else {
          this.emitLog(id, "warn", "Chain cancelled");
        }
      } else if (hasWarnings) {
        finalStatus = "completed_with_warnings";
      } else {
        finalStatus = "completed";
      }

      this.db.prepare(
        `UPDATE _automation_runs SET
          status = ?, completed_at = ?, duration_ms = ?,
          steps_completed = ?, total_input_tokens = ?, total_output_tokens = ?
        WHERE id = ?`,
      ).run(finalStatus, completedAt, durationMs, stepsCompleted, totalInputTokens, totalOutputTokens, id);

      // Step f — Worktree cleanup
      if (worktree && this.worktreeManager) {
        const success = finalStatus === "completed" || finalStatus === "completed_with_warnings";
        const wtCleanup = automation.worktree?.cleanup ?? "always";
        let worktreeStatus = "active";

        if (wtCleanup === "always" || (wtCleanup === "on_success" && success)) {
          await this.worktreeManager.markCompleted(worktree.id, true);
          worktreeStatus = "cleaned_up";
        } else if (wtCleanup === "never" || (wtCleanup === "on_success" && !success)) {
          worktreeStatus = "retained";
        }
        // ttl: worktreeStatus remains "active" (default)

        this.db.prepare(
          "UPDATE _automation_runs SET worktree_status = ? WHERE id = ?",
        ).run(worktreeStatus, id);
      }

      // Step g — Emit run completed
      this.io.to(`project:${automation.projectId}`).emit("automation:run-completed", {
        runId: id, automationId: automation.id, automationName: automation.name,
        projectId: automation.projectId, status: finalStatus, durationMs,
      });

      logger.info("automations", `Run ${finalStatus}`, {
        runId: id, automationId: automation.id, triggerType,
        steps: stepsCompleted, tokens: totalInputTokens + totalOutputTokens,
      });

      return id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      this.db.prepare(
        `UPDATE _automation_runs SET
          status = 'failed', error = ?, completed_at = ?, duration_ms = ?,
          steps_completed = ?, total_input_tokens = ?, total_output_tokens = ?
        WHERE id = ?`,
      ).run(msg, completedAt, durationMs, stepsCompleted, totalInputTokens, totalOutputTokens, id);

      // Worktree error cleanup
      if (worktree && this.worktreeManager) {
        const wtCleanup = automation.worktree?.cleanup ?? "always";
        if (wtCleanup === "always") {
          await this.worktreeManager.remove(worktree.id).catch(() => {});
        }
        this.db.prepare(
          "UPDATE _automation_runs SET worktree_status = ? WHERE id = ?",
        ).run(wtCleanup === "always" ? "cleaned_up" : "retained", id);
      }

      this.io.to(`project:${automation.projectId}`).emit("automation:run-failed", {
        runId: id, automationId: automation.id, automationName: automation.name,
        projectId: automation.projectId, error: msg,
      });

      logger.error("automations", `Run failed: ${msg}`, {
        runId: id, automationId: automation.id,
      });

      return id;
    } finally {
      // Step h — Cleanup
      this.activeRuns.delete(id);
      if (chainTimeout) clearTimeout(chainTimeout);
    }
  }

  // -------------------------------------------------------------------------
  // Socket.IO Log Helper (Phase 5 — Task 5.2)
  // -------------------------------------------------------------------------

  private emitLog(runId: string, level: string, message: string): void {
    this.io.to(`automation:${runId}`).emit("automation:log", {
      runId,
      level,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------------
  // System Prompt Assembly (Phase 4 — Task 4.5)
  // -------------------------------------------------------------------------

  private async assembleStepSystemPrompt(
    automation: Automation,
    step: PromptStep,
    stepIndex: number,
    cwd: string | undefined,
  ): Promise<string> {
    const parts: string[] = [];

    // Layer 1: Project context from ContextRecipeEngine
    try {
      // More context budget for early steps
      const tokenBudget = Math.max(1000, 4000 - stepIndex * 500);
      const context = await assembleContext(automation.projectId, tokenBudget);
      if (context.content) {
        parts.push(context.content);
      }
    } catch {
      // Context assembly may fail if no recipe configured
    }

    // Layer 2: Automation-level system prompt (user-defined)
    if (automation.systemPrompt) {
      const resolved = resolveTemplate(automation.systemPrompt, {
        "project.id": automation.projectId,
        "project.name": getProjectRegistry().get(automation.projectId)?.name ?? "Unknown",
      });
      parts.push(resolved);
    }

    // Layer 3: Chain execution context
    const outputFormatHint = step.outputFormat === "json" ? "JSON" : "text";
    parts.push(
      `This is step ${stepIndex + 1} of ${automation.chain.length} in an automated workflow.` +
      (stepIndex > 0 ? "\nYou will receive the output of the previous step as context." : "") +
      `\nRespond with ${outputFormatHint}.` +
      (cwd ? `\nWorking directory: ${cwd}` : ""),
    );

    return parts.join("\n\n---\n\n");
  }

  // -------------------------------------------------------------------------
  // Accessors (for testing and external coordination)
  // -------------------------------------------------------------------------

  getScheduledJobCount(): number {
    return this.scheduledJobs.size;
  }

  getActiveRunCount(): number {
    return this.activeRuns.size;
  }

  getPendingTimeoutCount(): number {
    return this.pendingTimeouts.size;
  }

  getConfig(): AutomationConfig {
    return { ...this.config };
  }
}

// ---------------------------------------------------------------------------
// Session Event Helpers
// ---------------------------------------------------------------------------

interface SessionEventLike {
  type?: string;
  data?: Record<string, unknown>;
}

function extractResponseText(events: unknown[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i] as SessionEventLike | undefined;
    if (!evt) continue;
    if (evt.type === "assistant.message") {
      const content = evt.data?.["content"];
      return typeof content === "string" ? content : "";
    }
  }
  return "";
}

function extractTokenUsage(events: unknown[]): { input: number; output: number } {
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i] as SessionEventLike | undefined;
    if (!evt) continue;
    if (evt.type === "session.usage_info") {
      const promptTokens = evt.data?.["promptTokens"];
      const completionTokens = evt.data?.["completionTokens"];
      return {
        input: typeof promptTokens === "number" ? promptTokens : 0,
        output: typeof completionTokens === "number" ? completionTokens : 0,
      };
    }
  }
  return { input: 0, output: 0 };
}
