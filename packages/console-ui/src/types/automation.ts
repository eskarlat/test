// Automation type definitions — Phase 8

// Schedule types
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
  extensions: string[] | "all";
  mcp: string[] | "all";
}

export interface PromptStep {
  id: string;
  name: string;
  prompt: string;
  model: string;
  reasoningEffort?: "low" | "medium" | "high";
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

export interface AutomationListItem {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  enabled: boolean;
  scheduleType: string;
  scheduleCron?: string;
  chainStepCount: number;
  createdAt: string;
  updatedAt: string;
  lastRun?: LastRunInfo;
}

export interface LastRunInfo {
  status: string;
  startedAt: string;
  durationMs: number | null;
}

export interface CreateAutomationInput {
  name: string;
  description?: string;
  schedule: AutomationSchedule;
  chain: PromptStep[];
  systemPrompt?: string;
  variables?: Record<string, string>;
  worktree?: WorktreeConfig;
  maxDurationMs?: number;
}

export interface UpdateAutomationInput {
  name?: string;
  description?: string;
  schedule?: AutomationSchedule;
  chain?: PromptStep[];
  systemPrompt?: string;
  variables?: Record<string, string>;
  worktree?: WorktreeConfig;
  maxDurationMs?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  capabilities?: string[];
}

// Extension cron jobs

export interface ExtensionCronJob {
  id: string;
  extensionName: string;
  name: string;
  cron: string;
  timezone: string | null;
  enabled: boolean;
  description: string | null;
  timeoutMs: number | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExtensionCronJobRun {
  id: string;
  jobId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

// Run types (for Phase 9)

export interface WorktreeRunInfo {
  worktreeId: string;
  path: string;
  branch: string;
  status: "active" | "cleaned_up" | "retained";
}

export interface ToolCallLog {
  toolName: string;
  source: "built-in" | "extension" | "mcp";
  extensionName?: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  success: boolean;
  autoApproved?: boolean;
  error?: string;
  startedAt: string;
  durationMs: number;
}

export interface StepExecution {
  stepId: string;
  stepName: string;
  stepIndex: number;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  resolvedPrompt?: string;
  systemPrompt?: string;
  model: string;
  reasoningEffort?: string;
  inputTokens?: number;
  outputTokens?: number;
  response?: string;
  toolCalls: ToolCallLog[];
  error?: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  projectId: string;
  status: AutomationRunStatus;
  triggerType: "scheduled" | "manual";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  stepCount: number;
  stepsCompleted: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  worktree?: WorktreeRunInfo;
  error?: string;
}

export interface AutomationRunDetail extends AutomationRun {
  steps: StepExecution[];
}

// Socket.IO event payloads

export interface RunStartedEvent {
  automationId: string;
  runId: string;
  automationName: string;
  trigger: "scheduled" | "manual";
  worktreePath?: string;
}

export interface RunCompletedEvent {
  automationId: string;
  runId: string;
  status: AutomationRunStatus;
  durationMs: number;
}

export interface StepStartedEvent {
  runId: string;
  stepId: string;
  stepIndex: number;
  stepName: string;
  model: string;
}

export interface StepCompletedEvent {
  runId: string;
  stepId: string;
  stepIndex: number;
  status: StepStatus;
  durationMs: number;
  outputPreview?: string;
}

export interface StepFailedEvent {
  runId: string;
  stepId: string;
  stepIndex: number;
  error: string;
}

export interface ToolCalledEvent {
  runId: string;
  stepId: string;
  toolName: string;
  source: "built-in" | "extension" | "mcp";
  durationMs: number;
  success: boolean;
  autoApproved?: boolean;
}

export interface MessageDeltaEvent {
  runId: string;
  stepId: string;
  deltaContent: string;
}

export interface AutomationLogEvent {
  runId: string;
  level: string;
  message: string;
  timestamp: string;
}
