import { useState, useCallback } from "react";
import { X, ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { cn } from "../../lib/utils";
import { ModelSelector } from "./ModelSelector";
import { SectionHelp } from "./SectionHelp";
import type { PromptStep, ModelInfo, ErrorStrategy, ToolAccess } from "../../types/automation";

interface PromptStepEditorProps {
  step: PromptStep;
  index: number;
  models: ModelInfo[];
  onChange: (updated: PromptStep) => void;
  onRemove: () => void;
}

type ExtensionMode = "all" | "specific";
type McpMode = "all" | "specific";

const inputClass = cn(
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
  "focus:outline-none focus:ring-2 focus:ring-primary/50",
);

const labelClass = "block text-xs font-medium mb-1";

const selectClass = cn(
  "rounded-md border border-border bg-background px-3 py-1.5 text-sm",
  "focus:outline-none focus:ring-2 focus:ring-primary/50",
);

// ---------------------------------------------------------------------------
// ToolAccessFieldset — extracted to reduce PromptStepEditor complexity
// ---------------------------------------------------------------------------

function parseCommaSeparated(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

interface ToolAccessFieldsetProps {
  stepId: string;
  tools: ToolAccess;
  onUpdate: (partial: Partial<ToolAccess>) => void;
}

function ToolAccessFieldset({ stepId, tools, onUpdate }: ToolAccessFieldsetProps) {
  const extensionMode: ExtensionMode = tools.extensions === "all" ? "all" : "specific";
  const mcpMode: McpMode = tools.mcp === "all" ? "all" : "specific";
  const extensionList = Array.isArray(tools.extensions) ? tools.extensions.join(", ") : "";
  const mcpList = Array.isArray(tools.mcp) ? tools.mcp.join(", ") : "";

  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-medium">Tool Access</legend>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={tools.builtIn}
          onChange={(e) => onUpdate({ builtIn: e.target.checked })}
          className="accent-primary rounded"
        />
        Built-in tools
      </label>

      {/* Extensions */}
      <div className="space-y-1.5">
        <span className="text-xs text-muted-foreground">Extensions</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input type="radio" name={`ext-mode-${stepId}`} value="all" checked={extensionMode === "all"} onChange={() => onUpdate({ extensions: "all" })} className="accent-primary" />
            All
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input type="radio" name={`ext-mode-${stepId}`} value="specific" checked={extensionMode === "specific"} onChange={() => onUpdate({ extensions: [] })} className="accent-primary" />
            Specific
          </label>
        </div>
        {extensionMode === "specific" && (
          <input
            type="text"
            value={extensionList}
            onChange={(e) => {
              const names = parseCommaSeparated(e.target.value);
              onUpdate({ extensions: names.length > 0 ? names : [] });
            }}
            placeholder="ext-name-1, ext-name-2"
            className={cn(inputClass, "text-xs")}
          />
        )}
      </div>

      {/* MCP */}
      <div className="space-y-1.5">
        <span className="text-xs text-muted-foreground">MCP Servers</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input type="radio" name={`mcp-mode-${stepId}`} value="all" checked={mcpMode === "all"} onChange={() => onUpdate({ mcp: "all" })} className="accent-primary" />
            All
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input type="radio" name={`mcp-mode-${stepId}`} value="specific" checked={mcpMode === "specific"} onChange={() => onUpdate({ mcp: [] })} className="accent-primary" />
            Specific
          </label>
        </div>
        {mcpMode === "specific" && (
          <input
            type="text"
            value={mcpList}
            onChange={(e) => {
              const names = parseCommaSeparated(e.target.value);
              onUpdate({ mcp: names.length > 0 ? names : [] });
            }}
            placeholder="server-1, server-2"
            className={cn(inputClass, "text-xs")}
          />
        )}
      </div>

      <SectionHelp title="Tool access help">
        <p>Built-in tools include file read/write, shell commands, and web search.</p>
        <p>Extension tools come from installed extensions. Select &quot;All&quot; to allow all, or list specific extension names.</p>
        <p>MCP tools come from connected MCP servers. Tool governance rules always apply.</p>
      </SectionHelp>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// StepBody — form fields, extracted to reduce PromptStepEditor complexity
// ---------------------------------------------------------------------------

interface StepBodyProps {
  step: PromptStep;
  models: ModelInfo[];
  onChange: (updated: PromptStep) => void;
}

function StepBody({ step, models, onChange }: StepBodyProps) {
  const update = useCallback(
    (fields: Partial<PromptStep>) => {
      onChange({ ...step, ...fields });
    },
    [step, onChange],
  );

  const clearField = useCallback(
    (key: "timeoutMs" | "maxTokens" | "retryCount") => {
      const next = { ...step };
      delete next[key];
      onChange(next);
    },
    [step, onChange],
  );

  const updateTools = useCallback(
    (partial: Partial<ToolAccess>) => {
      onChange({ ...step, tools: { ...step.tools, ...partial } });
    },
    [step, onChange],
  );

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Name */}
      <div>
        <label className={labelClass}>Step Name</label>
        <input type="text" value={step.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g., Gather context" className={inputClass} />
      </div>

      {/* Model + Reasoning Effort */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Model</label>
          <ModelSelector models={models} value={step.model} onChange={(modelId) => update({ model: modelId })} />
        </div>
        <div>
          <label className={labelClass}>Reasoning Effort</label>
          <select value={step.reasoningEffort ?? "medium"} onChange={(e) => update({ reasoningEffort: e.target.value as "low" | "medium" | "high" })} className={cn(selectClass, "w-full")}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>

      {/* Timeout */}
      <div>
        <label className={labelClass}>Timeout (seconds)</label>
        <input
          type="number"
          min={1}
          value={step.timeoutMs != null ? Math.round(step.timeoutMs / 1000) : ""}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "") {
              clearField("timeoutMs");
            } else {
              const secs = parseInt(val, 10);
              if (!isNaN(secs) && secs > 0) update({ timeoutMs: secs * 1000 });
            }
          }}
          placeholder="Default"
          className={cn(inputClass, "w-40")}
        />
      </div>

      {/* Tool access */}
      <ToolAccessFieldset stepId={step.id} tools={step.tools} onUpdate={updateTools} />

      {/* Error handling */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Error Handling</label>
          <select
            value={step.onError}
            onChange={(e) => {
              const strategy = e.target.value as ErrorStrategy;
              if (strategy === "retry") {
                update({ onError: strategy, retryCount: step.retryCount ?? 1 });
              } else {
                const next = { ...step, onError: strategy };
                delete next.retryCount;
                onChange(next);
              }
            }}
            className={cn(selectClass, "w-full")}
          >
            <option value="stop">Stop chain</option>
            <option value="skip">Skip step</option>
            <option value="retry">Retry</option>
          </select>
        </div>
        {step.onError === "retry" && (
          <div>
            <label className={labelClass}>Retry Count</label>
            <input
              type="number"
              min={1}
              max={5}
              value={step.retryCount ?? 1}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val > 0) update({ retryCount: val });
              }}
              className={cn(inputClass, "w-24")}
            />
          </div>
        )}
      </div>

      {/* Output format */}
      <div>
        <label className={labelClass}>Output Format</label>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" name={`output-${step.id}`} value="text" checked={(step.outputFormat ?? "text") === "text"} onChange={() => update({ outputFormat: "text" })} className="accent-primary" />
            Text
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" name={`output-${step.id}`} value="json" checked={step.outputFormat === "json"} onChange={() => update({ outputFormat: "json" })} className="accent-primary" />
            JSON
          </label>
        </div>
      </div>

      {/* Max tokens */}
      <div>
        <label className={labelClass}>Max Tokens (optional)</label>
        <input
          type="number"
          min={1}
          value={step.maxTokens ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "") {
              clearField("maxTokens");
            } else {
              const num = parseInt(val, 10);
              if (!isNaN(num) && num > 0) update({ maxTokens: num });
            }
          }}
          placeholder="Default"
          className={cn(inputClass, "w-40")}
        />
      </div>

      {/* Prompt textarea */}
      <div>
        <label className={labelClass}>Prompt</label>
        <textarea
          value={step.prompt}
          onChange={(e) => update({ prompt: e.target.value })}
          rows={6}
          placeholder="Enter the prompt for this step. Use {{previous_output}} to reference the output from the previous step, or {{variables.name}} for template variables."
          className={cn(inputClass, "resize-y min-h-[100px] font-mono text-xs")}
        />
        <SectionHelp title="Template variables">
          <p><code className="bg-muted px-1 rounded">{"{{previous_output}}"}</code> - Output from the previous step</p>
          <p><code className="bg-muted px-1 rounded">{"{{steps.stepName.output}}"}</code> - Output from a named step</p>
          <p><code className="bg-muted px-1 rounded">{"{{variables.key}}"}</code> - User-defined variable</p>
          <p><code className="bg-muted px-1 rounded">{"{{project.name}}"}</code> - Current project name</p>
          <p><code className="bg-muted px-1 rounded">{"{{timestamp}}"}</code> - Current ISO timestamp</p>
        </SectionHelp>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PromptStepEditor
// ---------------------------------------------------------------------------

export function PromptStepEditor({ step, index, models, onChange, onRemove }: PromptStepEditorProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Step header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
        <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0 cursor-grab" aria-hidden="true" />
        <span className="text-sm font-medium flex-1 truncate">
          Step {index + 1}: {step.name || "(unnamed)"}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label={collapsed ? "Expand step" : "Collapse step"}
        >
          {collapsed ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 rounded-md text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
          aria-label="Remove step"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Step body */}
      {!collapsed && <StepBody step={step} models={models} onChange={onChange} />}
    </div>
  );
}
