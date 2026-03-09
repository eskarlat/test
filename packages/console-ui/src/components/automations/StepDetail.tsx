import { useState, useCallback } from "react";
import { ChevronDown, ChevronRight, Wrench, Shield, Bot } from "lucide-react";
import { cn } from "../../lib/utils";
import { RunStatusBadge } from "./RunStatusBadge";
import type { StepExecution, ToolCallLog } from "../../types/automation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | undefined): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatTimestamp(dateStr: string | undefined): string {
  if (!dateStr) return "-";
  try {
    return new Date(dateStr).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabKey = "prompt" | "response" | "tools" | "debug";

interface TabItem {
  key: TabKey;
  label: string;
}

function buildTabs(toolCount: number): TabItem[] {
  return [
    { key: "prompt", label: "Prompt" },
    { key: "response", label: "Response" },
    { key: "tools", label: `Tools (${toolCount})` },
    { key: "debug", label: "Debug" },
  ];
}

// ---------------------------------------------------------------------------
// ToolSourceBadge
// ---------------------------------------------------------------------------

function ToolSourceBadge({ source }: { source: string }) {
  const config: Record<string, { label: string; className: string }> = {
    "built-in": {
      label: "Built-in",
      className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    },
    extension: {
      label: "Extension",
      className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    },
    mcp: {
      label: "MCP",
      className: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    },
  };
  const c = config[source] ?? config["built-in"]!;

  return (
    <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium", c.className)}>
      {c.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ToolCallRow
// ---------------------------------------------------------------------------

interface ToolCallRowProps {
  tool: ToolCallLog;
  index: number;
}

function ToolCallRow({ tool, index }: ToolCallRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border/50 rounded-md">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-accent/50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
        )}
        <span className="text-muted-foreground w-6 tabular-nums">{index + 1}</span>
        <Wrench className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium truncate">{tool.toolName}</span>
        <ToolSourceBadge source={tool.source} />
        <span className={cn("ml-auto flex-shrink-0", tool.success ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
          {tool.success ? "OK" : "FAIL"}
        </span>
        <span className="text-muted-foreground tabular-nums flex-shrink-0">{formatDuration(tool.durationMs)}</span>
        {tool.autoApproved && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-1.5 py-0.5 text-[9px] font-medium flex-shrink-0">
            <Bot className="h-2.5 w-2.5" aria-hidden="true" />
            AUTOPILOT
          </span>
        )}
        {!tool.success && tool.error && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 px-1.5 py-0.5 text-[9px] font-medium flex-shrink-0">
            <Shield className="h-2.5 w-2.5" aria-hidden="true" />
            DENIED
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/50">
          <ToolCallDetail tool={tool} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolCallDetail — expanded view for a single tool call
// ---------------------------------------------------------------------------

function ToolCallDetail({ tool }: { tool: ToolCallLog }) {
  return (
    <div className="space-y-2 pt-2">
      <div>
        <span className="text-[10px] font-medium text-muted-foreground uppercase">Arguments</span>
        <pre className="mt-1 bg-muted rounded-md p-2 text-[11px] font-mono overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
          {JSON.stringify(tool.arguments, null, 2)}
        </pre>
      </div>

      {tool.result !== undefined && (
        <div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase">Result</span>
          <pre className="mt-1 bg-muted rounded-md p-2 text-[11px] font-mono overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
            {truncateJson(tool.result)}
          </pre>
        </div>
      )}

      {tool.error && (
        <div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase">Error</span>
          <pre className="mt-1 bg-red-50 dark:bg-red-950/30 rounded-md p-2 text-[11px] font-mono text-red-600 dark:text-red-400 overflow-x-auto whitespace-pre-wrap break-all">
            {tool.error}
          </pre>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground">
        <span>Started: {formatTimestamp(tool.startedAt)}</span>
      </div>
    </div>
  );
}

function truncateJson(value: unknown): string {
  const str = JSON.stringify(value, null, 2);
  if (str.length > 2000) {
    return str.slice(0, 2000) + "\n... (truncated)";
  }
  return str;
}

// ---------------------------------------------------------------------------
// Tab content components
// ---------------------------------------------------------------------------

function PromptTab({ step }: { step: StepExecution }) {
  return (
    <div className="space-y-4">
      {step.resolvedPrompt && (
        <div>
          <span className="text-xs font-medium text-muted-foreground">Resolved Prompt:</span>
          <pre className="mt-1 bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto max-h-60 whitespace-pre-wrap break-words">
            {step.resolvedPrompt}
          </pre>
        </div>
      )}

      {step.systemPrompt && (
        <div>
          <span className="text-xs font-medium text-muted-foreground">System Prompt:</span>
          <pre className="mt-1 bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto max-h-40 whitespace-pre-wrap break-words">
            {step.systemPrompt}
          </pre>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Model: <span className="font-medium text-foreground">{step.model}</span></span>
        {step.reasoningEffort && (
          <span>Effort: <span className="font-medium text-foreground capitalize">{step.reasoningEffort}</span></span>
        )}
      </div>
    </div>
  );
}

function ResponseTab({ step }: { step: StepExecution }) {
  return (
    <div className="space-y-3">
      {step.response ? (
        <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto max-h-80 whitespace-pre-wrap break-words">
          {step.response}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground italic">No response available.</p>
      )}

      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>Input: <span className="font-medium tabular-nums">{step.inputTokens?.toLocaleString() ?? "-"}</span></span>
        <span>Output: <span className="font-medium tabular-nums">{step.outputTokens?.toLocaleString() ?? "-"}</span></span>
      </div>
    </div>
  );
}

function ToolsTab({ step }: { step: StepExecution }) {
  if (step.toolCalls.length === 0) {
    return <p className="text-xs text-muted-foreground italic py-2">No tool calls in this step.</p>;
  }

  return (
    <div className="space-y-2">
      {step.toolCalls.map((tool, i) => (
        <ToolCallRow key={`${tool.toolName}-${tool.startedAt}-${i}`} tool={tool} index={i} />
      ))}
    </div>
  );
}

function DebugTab({ step }: { step: StepExecution }) {
  const autoApprovedCount = step.toolCalls.filter((t) => t.autoApproved).length;

  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        <DebugRow label="Model" value={step.model} />
        <DebugRow label="Reasoning Effort" value={step.reasoningEffort ?? "-"} />
        <DebugRow label="Step Index" value={String(step.stepIndex)} />
        <DebugRow label="Status" value={step.status} />
        <DebugRow label="Started At" value={formatTimestamp(step.startedAt)} />
        <DebugRow label="Completed At" value={formatTimestamp(step.completedAt)} />
        <DebugRow label="Duration" value={formatDuration(step.durationMs)} />
        <DebugRow label="Input Tokens" value={step.inputTokens?.toLocaleString() ?? "-"} />
        <DebugRow label="Output Tokens" value={step.outputTokens?.toLocaleString() ?? "-"} />
        <DebugRow label="Total Tool Calls" value={String(step.toolCalls.length)} />
        <DebugRow label="Auto-approved Tools" value={String(autoApprovedCount)} />
      </div>

      {step.error && (
        <div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase">Error Details</span>
          <pre className="mt-1 bg-red-50 dark:bg-red-950/30 rounded-md p-2 text-[11px] font-mono text-red-600 dark:text-red-400 overflow-x-auto whitespace-pre-wrap break-all">
            {step.error}
          </pre>
        </div>
      )}
    </div>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}:</span>
      <span className="ml-1 font-medium text-foreground">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepDetail
// ---------------------------------------------------------------------------

interface StepDetailProps {
  step: StepExecution;
  index: number;
  defaultExpanded?: boolean;
}

export function StepDetail({ step, index, defaultExpanded = false }: StepDetailProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [activeTab, setActiveTab] = useState<TabKey>("prompt");
  const tabs = buildTabs(step.toolCalls.length);

  const handleToggle = useCallback(() => setExpanded((v) => !v), []);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Collapsible header */}
      <button
        onClick={handleToggle}
        className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-accent/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        )}
        <span className="text-xs text-muted-foreground tabular-nums w-6">#{index + 1}</span>
        <span className="text-sm font-medium truncate">{step.stepName}</span>
        <RunStatusBadge status={step.status} variant="step" />
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{formatDuration(step.durationMs)}</span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border">
          {/* Tab bar */}
          <div className="flex border-b border-border px-4">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
                  activeTab === tab.key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-4">
            {activeTab === "prompt" && <PromptTab step={step} />}
            {activeTab === "response" && <ResponseTab step={step} />}
            {activeTab === "tools" && <ToolsTab step={step} />}
            {activeTab === "debug" && <DebugTab step={step} />}
          </div>
        </div>
      )}
    </div>
  );
}
