import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import {
  Timer,
  ArrowLeft,
  ArrowDown,
  Save,
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  HelpCircle,
  Loader2,
} from "lucide-react";
import { cn } from "../lib/utils";
import { uuid } from "../lib/utils";
import { apiGet } from "../api/client";
import { useAutomationStore, type AutomationStore } from "../stores/automation-store";
import { useNotificationStore } from "../stores/notification-store";
import { AutopilotDialog } from "../components/automations/AutopilotDialog";
import { HelpDrawer } from "../components/automations/HelpDrawer";
import { SectionHelp } from "../components/automations/SectionHelp";
import type {
  Automation,
  AutomationSchedule,
  AutomationScheduleType,
  PromptStep,
  ToolAccess,
  WorktreeConfig,
  ErrorStrategy,
  CreateAutomationInput,
  UpdateAutomationInput,
  ModelInfo,
} from "../types/automation";

// Stable selectors
const selectModels = (s: AutomationStore) => s.models;
const selectFetchModels = (s: AutomationStore) => s.fetchModels;
const selectCreate = (s: AutomationStore) => s.createAutomation;
const selectUpdate = (s: AutomationStore) => s.updateAutomation;

function createDefaultStep(models: ModelInfo[]): PromptStep {
  return {
    id: uuid(),
    name: "",
    prompt: "",
    model: models[0]?.id ?? "",
    tools: { builtIn: true, extensions: "all", mcp: "all" },
    onError: "stop",
  };
}

function createDefaultSchedule(): AutomationSchedule {
  return { type: "manual" };
}

function createDefaultWorktree(): WorktreeConfig {
  return { enabled: false, cleanup: "on_success" };
}

interface StepEditorProps {
  step: PromptStep;
  index: number;
  models: ModelInfo[];
  totalSteps: number;
  onChange: (index: number, step: PromptStep) => void;
  onRemove: (index: number) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

// ---------------------------------------------------------------------------
// StepEditorBody — extracted to reduce StepEditor complexity (Gap 5)
// ---------------------------------------------------------------------------

interface StepEditorBodyProps {
  step: PromptStep;
  index: number;
  models: ModelInfo[];
  update: (partial: Partial<PromptStep>) => void;
  updateTools: (partial: Partial<ToolAccess>) => void;
  onChange: (index: number, step: PromptStep) => void;
}

function StepEditorBody({ step, index, models, update, updateTools, onChange }: StepEditorBodyProps) {
  return (
    <div className="p-4 space-y-4">
      {/* Step name */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`step-name-${step.id}`}>
          Step Name
        </label>
        <input
          id={`step-name-${step.id}`}
          type="text"
          value={step.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="e.g., Analyze code quality"
          className={cn(
            "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring",
          )}
        />
      </div>

      {/* Prompt */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`step-prompt-${step.id}`}>
          Prompt
        </label>
        <textarea
          id={`step-prompt-${step.id}`}
          value={step.prompt}
          onChange={(e) => update({ prompt: e.target.value })}
          placeholder="Enter the prompt for this step. Use {{variable}} for variable interpolation and {{prev.output}} for previous step output."
          rows={4}
          className={cn(
            "w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono",
            "focus:outline-none focus:ring-2 focus:ring-ring resize-y",
          )}
        />
      </div>

      {/* Model + reasoning effort row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`step-model-${step.id}`}>
            Model
          </label>
          <select
            id={`step-model-${step.id}`}
            value={step.model}
            onChange={(e) => update({ model: e.target.value })}
            className={cn(
              "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          >
            <option value="">Select model</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`step-effort-${step.id}`}>
            Reasoning Effort
          </label>
          <select
            id={`step-effort-${step.id}`}
            value={step.reasoningEffort ?? ""}
            onChange={(e) => {
              const val = e.target.value as "low" | "medium" | "high" | "";
              if (val) {
                update({ reasoningEffort: val });
              } else {
                const next = { ...step };
                delete (next as Record<string, unknown>)["reasoningEffort"];
                onChange(index, next);
              }
            }}
            className={cn(
              "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          >
            <option value="">Default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>

      {/* Error strategy + output format + max tokens */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`step-onerror-${step.id}`}>
            On Error
          </label>
          <select
            id={`step-onerror-${step.id}`}
            value={step.onError}
            onChange={(e) => update({ onError: e.target.value as ErrorStrategy })}
            className={cn(
              "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          >
            <option value="stop">Stop</option>
            <option value="skip">Skip</option>
            <option value="retry">Retry</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`step-format-${step.id}`}>
            Output Format
          </label>
          <select
            id={`step-format-${step.id}`}
            value={step.outputFormat ?? "text"}
            onChange={(e) => {
              const val = e.target.value as "text" | "json";
              update({ outputFormat: val });
            }}
            className={cn(
              "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          >
            <option value="text">Text</option>
            <option value="json">JSON</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`step-maxtokens-${step.id}`}>
            Max Tokens
          </label>
          <input
            id={`step-maxtokens-${step.id}`}
            type="number"
            value={step.maxTokens ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              if (val) {
                update({ maxTokens: parseInt(val, 10) });
              } else {
                const { maxTokens: _, ...rest } = step;
                onChange(index, rest as PromptStep);
              }
            }}
            placeholder="Default"
            className={cn(
              "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          />
        </div>
      </div>

      {/* Tool access */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">Tool Access</span>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={step.tools.builtIn}
              onChange={(e) => updateTools({ builtIn: e.target.checked })}
              className="rounded border-border"
            />
            Built-in tools
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={step.tools.extensions === "all"}
              onChange={(e) => updateTools({ extensions: e.target.checked ? "all" : [] })}
              className="rounded border-border"
            />
            All extensions
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={step.tools.mcp === "all"}
              onChange={(e) => updateTools({ mcp: e.target.checked ? "all" : [] })}
              className="rounded border-border"
            />
            All MCP servers
          </label>
        </div>
      </div>

      {/* Retry count (visible only when onError is retry) */}
      {step.onError === "retry" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`step-retry-${step.id}`}>
            Retry Count
          </label>
          <input
            id={`step-retry-${step.id}`}
            type="number"
            min={1}
            max={5}
            value={step.retryCount ?? 1}
            onChange={(e) => update({ retryCount: parseInt(e.target.value, 10) || 1 })}
            className={cn(
              "w-32 rounded-md border border-border bg-background px-3 py-1.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          />
        </div>
      )}

      {/* Step timeout */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`step-timeout-${step.id}`}>
          Step Timeout (seconds)
        </label>
        <input
          id={`step-timeout-${step.id}`}
          type="number"
          value={step.timeoutMs != null ? step.timeoutMs / 1000 : ""}
          onChange={(e) => {
            const val = e.target.value;
            if (val) {
              update({ timeoutMs: parseFloat(val) * 1000 });
            } else {
              const { timeoutMs: _, ...rest } = step;
              onChange(index, rest as PromptStep);
            }
          }}
          placeholder="No timeout"
          className={cn(
            "w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring",
          )}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepEditor
// ---------------------------------------------------------------------------

function StepEditor({ step, index, models, totalSteps, onChange, onRemove, onMoveUp, onMoveDown, canMoveUp, canMoveDown }: StepEditorProps) {
  const [expanded, setExpanded] = useState(true);

  const update = useCallback(
    (partial: Partial<PromptStep>) => {
      onChange(index, { ...step, ...partial });
    },
    [index, step, onChange],
  );

  const updateTools = useCallback(
    (partial: Partial<ToolAccess>) => {
      onChange(index, { ...step, tools: { ...step.tools, ...partial } });
    },
    [index, step, onChange],
  );

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Step header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div className="flex flex-col flex-shrink-0">
          <button disabled={!canMoveUp} onClick={onMoveUp} className={cn("text-muted-foreground", canMoveUp ? "hover:text-foreground" : "opacity-30")} title="Move up">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button disabled={!canMoveDown} onClick={onMoveDown} className={cn("text-muted-foreground", canMoveDown ? "hover:text-foreground" : "opacity-30")} title="Move down">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0 cursor-grab" aria-hidden="true" />
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="text-sm font-medium truncate">
            Step {index + 1}{step.name ? `: ${step.name}` : ""}
          </span>
        </button>
        {totalSteps > 1 && (
          <button
            onClick={() => onRemove(index)}
            className="flex-shrink-0 text-red-500 hover:text-red-600 transition-colors"
            title="Remove step"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {expanded && (
        <StepEditorBody
          step={step}
          index={index}
          models={models}
          update={update}
          updateTools={updateTools}
          onChange={onChange}
        />
      )}
    </div>
  );
}

export default function AutomationEditorPage() {
  const { projectId, id } = useParams<{ projectId: string; id: string }>();
  const navigate = useNavigate();
  const isEditMode = Boolean(id);

  const models = useAutomationStore(selectModels);
  const fetchModels = useAutomationStore(selectFetchModels);
  const createAutomation = useAutomationStore(selectCreate);
  const updateAutomation = useAutomationStore(selectUpdate);
  const addToast = useNotificationStore((s) => s.addToast);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState<AutomationSchedule>(createDefaultSchedule);
  const [chain, setChain] = useState<PromptStep[]>([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [worktree, setWorktree] = useState<WorktreeConfig>(createDefaultWorktree);
  const [maxDurationMs, setMaxDurationMs] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Autopilot dialog state (Gap 1)
  const [showAutopilot, setShowAutopilot] = useState(false);

  // Help drawer state (Gap 3)
  const [helpOpen, setHelpOpen] = useState(false);

  // Variable editor state
  const [newVarKey, setNewVarKey] = useState("");
  const [newVarValue, setNewVarValue] = useState("");

  // Fetch models on mount
  useEffect(() => {
    if (!projectId) return;
    fetchModels(projectId);
  }, [projectId, fetchModels]);

  // Initialize default step once models are loaded and this is a new automation
  useEffect(() => {
    if (!isEditMode && chain.length === 0 && models.length > 0) {
      setChain([createDefaultStep(models)]);
    }
  }, [isEditMode, chain.length, models]);

  // Load existing automation for edit mode
  useEffect(() => {
    if (!projectId || !id) return;
    setLoadingExisting(true);
    setLoadError(null);

    apiGet<Automation>(`/api/${projectId}/automations/${id}`).then((res) => {
      if (res.data) {
        const a = res.data;
        setName(a.name);
        if (a.description) setDescription(a.description);
        setSchedule(a.schedule);
        setChain(a.chain);
        if (a.systemPrompt) setSystemPrompt(a.systemPrompt);
        if (a.variables) setVariables(a.variables);
        if (a.worktree) setWorktree(a.worktree);
        if (a.maxDurationMs != null) setMaxDurationMs(a.maxDurationMs);
        setOriginalEnabled(a.enabled);
      } else {
        setLoadError(res.error ?? "Failed to load automation");
      }
      setLoadingExisting(false);
    });
  }, [projectId, id]);

  // Chain mutation handlers
  const handleStepChange = useCallback((index: number, step: PromptStep) => {
    setChain((prev) => prev.map((s, i) => (i === index ? step : s)));
  }, []);

  const handleStepRemove = useCallback((index: number) => {
    setChain((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAddStep = useCallback(() => {
    setChain((prev) => [...prev, createDefaultStep(models)]);
  }, [models]);

  const handleMoveStep = useCallback((fromIndex: number, direction: "up" | "down") => {
    setChain((prev) => {
      const next = [...prev];
      const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
      const a = next[fromIndex];
      const b = next[toIndex];
      if (a && b) {
        next[fromIndex] = b;
        next[toIndex] = a;
      }
      return next;
    });
  }, []);

  // Variable handlers
  const handleAddVariable = useCallback(() => {
    const key = newVarKey.trim();
    if (!key) return;
    setVariables((prev) => ({ ...prev, [key]: newVarValue }));
    setNewVarKey("");
    setNewVarValue("");
  }, [newVarKey, newVarValue]);

  const handleRemoveVariable = useCallback((key: string) => {
    setVariables((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Track whether the automation was originally disabled (for re-enable detection in edit mode)
  const [originalEnabled, setOriginalEnabled] = useState<boolean | null>(null);

  // Validation helper (shared between handleSave and performSave)
  const validateForm = useCallback((): boolean => {
    if (!projectId) return false;
    if (!name.trim()) {
      addToast("Automation name is required", "error");
      return false;
    }
    if (chain.length === 0) {
      addToast("At least one prompt step is required", "error");
      return false;
    }
    for (const step of chain) {
      if (!step.prompt.trim()) {
        addToast(`Step "${step.name || "unnamed"}" needs a prompt`, "error");
        return false;
      }
      if (!step.model) {
        addToast(`Step "${step.name || "unnamed"}" needs a model`, "error");
        return false;
      }
    }
    return true;
  }, [projectId, name, chain, addToast]);

  // Perform the actual save (called after autopilot confirmation or directly for updates)
  const performSave = useCallback(async () => {
    if (!projectId) return;

    setSaving(true);
    try {
      if (isEditMode && id) {
        const updates: UpdateAutomationInput = {
          name: name.trim(),
          schedule,
          chain,
        };
        if (description.trim()) updates.description = description.trim();
        if (systemPrompt.trim()) updates.systemPrompt = systemPrompt.trim();
        if (Object.keys(variables).length > 0) updates.variables = variables;
        if (worktree.enabled) updates.worktree = worktree;
        if (maxDurationMs != null) updates.maxDurationMs = maxDurationMs;

        await updateAutomation(projectId, id, updates);
        addToast("Automation updated", "success");
      } else {
        const input: CreateAutomationInput = {
          name: name.trim(),
          schedule,
          chain,
        };
        if (description.trim()) input.description = description.trim();
        if (systemPrompt.trim()) input.systemPrompt = systemPrompt.trim();
        if (Object.keys(variables).length > 0) input.variables = variables;
        if (worktree.enabled) input.worktree = worktree;
        if (maxDurationMs != null) input.maxDurationMs = maxDurationMs;

        await createAutomation(projectId, input);
        addToast("Automation created", "success");
      }
      navigate(`/${projectId}/automations`);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Save failed",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }, [
    projectId, id, isEditMode, name, description, schedule, chain,
    systemPrompt, variables, worktree, maxDurationMs,
    createAutomation, updateAutomation, addToast, navigate,
  ]);

  // Save handler — shows autopilot dialog for new automations or re-enabling disabled ones
  const handleSave = useCallback(() => {
    if (!validateForm()) return;

    const needsAutopilot = !isEditMode || (originalEnabled === false);
    if (needsAutopilot) {
      setShowAutopilot(true);
      return;
    }

    void performSave();
  }, [validateForm, isEditMode, originalEnabled, performSave]);

  // Autopilot confirm handler
  const handleAutopilotConfirm = useCallback(() => {
    setShowAutopilot(false);
    void performSave();
  }, [performSave]);

  const handleBack = useCallback(() => {
    navigate(`/${projectId}/automations`);
  }, [navigate, projectId]);

  if (!projectId) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        Select a project to create automations.
      </div>
    );
  }

  if (loadingExisting) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading automation...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-50 dark:bg-red-950/30 p-6 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        <button
          onClick={handleBack}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-accent text-accent-foreground hover:bg-accent/80 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Automations
        </button>
      </div>
    );
  }

  const variableEntries = Object.entries(variables);

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleBack}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Back to automations"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="flex items-center gap-2 text-xl font-semibold flex-1">
          <Timer className="h-5 w-5" aria-hidden="true" />
          {isEditMode ? "Edit Automation" : "New Automation"}
        </h1>
        <button
          onClick={() => setHelpOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          Help
        </button>
      </div>

      {/* Name & description */}
      <section className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="automation-name">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="automation-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Nightly Code Review"
            className={cn(
              "w-full rounded-md border border-border bg-background px-3 py-2 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="automation-description">
            Description
          </label>
          <textarea
            id="automation-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description of what this automation does"
            rows={2}
            className={cn(
              "w-full rounded-md border border-border bg-background px-3 py-2 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring resize-y",
            )}
          />
        </div>
      </section>

      {/* Schedule */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Schedule</h2>
          <SectionHelp title="Schedule Help">
            <p>Cron: Standard 5-field cron expression (minute hour day month weekday). Examples: &quot;0 9 * * 1-5&quot; = weekdays at 9am, &quot;*/30 * * * *&quot; = every 30 minutes.</p>
            <p className="mt-1">Once: Runs at a specific date/time, then auto-disables.</p>
            <p className="mt-1">Manual: Only runs when you click &quot;Run Now&quot;.</p>
          </SectionHelp>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="schedule-type">
              Type
            </label>
            <select
              id="schedule-type"
              value={schedule.type}
              onChange={(e) => {
                const type = e.target.value as AutomationScheduleType;
                setSchedule({ type });
              }}
              className={cn(
                "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
                "focus:outline-none focus:ring-2 focus:ring-ring",
              )}
            >
              <option value="manual">Manual</option>
              <option value="cron">Cron</option>
              <option value="once">One-time</option>
            </select>
          </div>

          {schedule.type === "cron" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="schedule-cron">
                Cron Expression
              </label>
              <input
                id="schedule-cron"
                type="text"
                value={schedule.cron ?? ""}
                onChange={(e) => setSchedule((prev) => ({ ...prev, cron: e.target.value }))}
                placeholder="0 0 * * *"
                className={cn(
                  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                )}
              />
            </div>
          )}

          {schedule.type === "once" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="schedule-runat">
                Run At
              </label>
              <input
                id="schedule-runat"
                type="datetime-local"
                value={schedule.runAt ?? ""}
                onChange={(e) => setSchedule((prev) => ({ ...prev, runAt: e.target.value }))}
                className={cn(
                  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                )}
              />
            </div>
          )}

          {schedule.type === "cron" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="schedule-timezone">
                Timezone
              </label>
              <input
                id="schedule-timezone"
                type="text"
                value={schedule.timezone ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) {
                    setSchedule((prev) => ({ ...prev, timezone: val }));
                  } else {
                    setSchedule((prev) => {
                      const { timezone: _, ...rest } = prev;
                      return rest as AutomationSchedule;
                    });
                  }
                }}
                placeholder="UTC"
                className={cn(
                  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                )}
              />
            </div>
          )}
        </div>
      </section>

      {/* Worktree */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Worktree Isolation</h2>
          <SectionHelp title="Worktree Help">
            <p>Worktrees create an isolated git working copy so the automation can read/write files without affecting your main checkout.</p>
            <p className="mt-1">Use when the automation modifies code. Skip for read-only queries.</p>
          </SectionHelp>
        </div>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={worktree.enabled}
              onChange={(e) => setWorktree((prev) => ({ ...prev, enabled: e.target.checked }))}
              className="rounded border-border"
            />
            Enable worktree isolation
          </label>

          {worktree.enabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-6">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="worktree-branch">
                  Branch
                </label>
                <input
                  id="worktree-branch"
                  type="text"
                  value={worktree.branch ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val) {
                      setWorktree((prev) => ({ ...prev, branch: val }));
                    } else {
                      setWorktree((prev) => {
                        const { branch: _, ...rest } = prev;
                        return rest as WorktreeConfig;
                      });
                    }
                  }}
                  placeholder="Auto-generated"
                  className={cn(
                    "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
                    "focus:outline-none focus:ring-2 focus:ring-ring",
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="worktree-cleanup">
                  Cleanup Policy
                </label>
                <select
                  id="worktree-cleanup"
                  value={worktree.cleanup}
                  onChange={(e) =>
                    setWorktree((prev) => ({
                      ...prev,
                      cleanup: e.target.value as WorktreeConfig["cleanup"],
                    }))
                  }
                  className={cn(
                    "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
                    "focus:outline-none focus:ring-2 focus:ring-ring",
                  )}
                >
                  <option value="always">Always</option>
                  <option value="on_success">On Success</option>
                  <option value="never">Never</option>
                  <option value="ttl">TTL</option>
                </select>
              </div>
              {worktree.cleanup === "ttl" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="worktree-ttl">
                    TTL (hours)
                  </label>
                  <input
                    id="worktree-ttl"
                    type="number"
                    min={1}
                    value={worktree.ttlMs != null ? worktree.ttlMs / 3_600_000 : ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) {
                        setWorktree((prev) => ({ ...prev, ttlMs: parseFloat(val) * 3_600_000 }));
                      } else {
                        setWorktree((prev) => {
                          const { ttlMs: _, ...rest } = prev;
                          return rest as WorktreeConfig;
                        });
                      }
                    }}
                    placeholder="24"
                    className={cn(
                      "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
                      "focus:outline-none focus:ring-2 focus:ring-ring",
                    )}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* System Prompt */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">System Prompt</h2>
          <SectionHelp title="System Prompt Help">
            <p>Injected as context for every step. Define the agent&apos;s role, set constraints, specify output preferences. Supports template variables.</p>
          </SectionHelp>
        </div>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Optional system prompt applied to all steps"
          rows={3}
          className={cn(
            "w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono",
            "focus:outline-none focus:ring-2 focus:ring-ring resize-y",
          )}
        />
      </section>

      {/* Variables */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Variables</h2>
          <SectionHelp title="Variables Help">
            <p>Define key-value pairs accessible in prompts via {"{{variables.key}}"} syntax. Also available: {"{{prev.output}}"}, {"{{project.name}}"}, {"{{now}}"}, {"{{worktree.path}}"}.</p>
          </SectionHelp>
        </div>
        <p className="text-xs text-muted-foreground">
          Define key-value pairs accessible in prompts via {"{{variableName}}"} syntax.
        </p>

        {variableEntries.length > 0 && (
          <div className="space-y-2">
            {variableEntries.map(([key, value]) => (
              <div key={key} className="flex items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 text-xs font-mono min-w-[120px]">{key}</code>
                <span className="text-xs text-muted-foreground">=</span>
                <span className="text-xs truncate flex-1">{value}</span>
                <button
                  onClick={() => handleRemoveVariable(key)}
                  className="flex-shrink-0 text-red-500 hover:text-red-600 transition-colors"
                  title="Remove variable"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="new-var-key">
              Key
            </label>
            <input
              id="new-var-key"
              type="text"
              value={newVarKey}
              onChange={(e) => setNewVarKey(e.target.value)}
              placeholder="key"
              className={cn(
                "w-32 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono",
                "focus:outline-none focus:ring-2 focus:ring-ring",
              )}
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="new-var-value">
              Value
            </label>
            <input
              id="new-var-value"
              type="text"
              value={newVarValue}
              onChange={(e) => setNewVarValue(e.target.value)}
              placeholder="value"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddVariable();
              }}
              className={cn(
                "w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs",
                "focus:outline-none focus:ring-2 focus:ring-ring",
              )}
            />
          </div>
          <button
            onClick={handleAddVariable}
            disabled={!newVarKey.trim()}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium",
              "hover:bg-accent transition-colors",
              !newVarKey.trim() && "opacity-50 cursor-not-allowed",
            )}
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            Add
          </button>
        </div>
      </section>

      {/* Prompt Chain */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Prompt Chain <span className="text-red-500">*</span></h2>
            <SectionHelp title="Prompt Chain Help">
              <p>Steps run sequentially. Each step&apos;s output is available to the next via {"{{prev.output}}"}. Use different models per step -- fast for data gathering, powerful for analysis.</p>
            </SectionHelp>
          </div>
          <button
            onClick={handleAddStep}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium",
              "hover:bg-accent transition-colors",
            )}
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            Add Step
          </button>
        </div>

        {chain.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            No steps yet. Add at least one prompt step.
          </p>
        )}

        <div className="space-y-3">
          {chain.map((step, index) => (
            <div key={step.id}>
              <StepEditor
                step={step}
                index={index}
                models={models}
                totalSteps={chain.length}
                onChange={handleStepChange}
                onRemove={handleStepRemove}
                onMoveUp={() => handleMoveStep(index, "up")}
                onMoveDown={() => handleMoveStep(index, "down")}
                canMoveUp={index > 0}
                canMoveDown={index < chain.length - 1}
              />
              {index < chain.length - 1 && (
                <div className="flex items-center justify-center py-1">
                  <div className="flex flex-col items-center text-muted-foreground">
                    <div className="w-px h-3 bg-border" />
                    <ArrowDown className="h-4 w-4" />
                    <span className="text-[10px]">output feeds into next step</span>
                    <div className="w-px h-3 bg-border" />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Max Duration */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Max Duration</h2>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="max-duration">
            Maximum total execution time (minutes)
          </label>
          <input
            id="max-duration"
            type="number"
            min={1}
            value={maxDurationMs != null ? maxDurationMs / 60_000 : ""}
            onChange={(e) => {
              const val = e.target.value;
              if (val) {
                setMaxDurationMs(parseFloat(val) * 60_000);
              } else {
                setMaxDurationMs(null);
              }
            }}
            placeholder="No limit"
            className={cn(
              "w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          />
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center gap-3 border-t border-border pt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium",
            "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
            saving && "opacity-50 cursor-not-allowed",
          )}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="h-4 w-4" aria-hidden="true" />
          )}
          {isEditMode ? "Update Automation" : "Create Automation"}
        </button>
        <button
          onClick={handleBack}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium",
            "text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
          )}
        >
          Cancel
        </button>
      </div>

      <AutopilotDialog
        open={showAutopilot}
        onConfirm={handleAutopilotConfirm}
        onCancel={() => setShowAutopilot(false)}
      />
      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
