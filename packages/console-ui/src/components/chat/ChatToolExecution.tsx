import { useState } from "react";
import { Loader2, Check, XCircle, ChevronDown, ChevronRight, Puzzle } from "lucide-react";
import { cn } from "../../lib/utils";
import { CopyButton } from "./CopyButton";
import { formatDuration } from "./format-duration";
import type { ToolExecutionBlock } from "../../types/chat";

/** Detect extension-namespaced tools: `extName__toolName` → { ext, tool } */
function parseNamespacedTool(toolName: string): { ext: string; tool: string } | null {
  const idx = toolName.indexOf("__");
  if (idx <= 0) return null;
  return { ext: toolName.slice(0, idx), tool: toolName.slice(idx + 2) };
}

function formatToolName(toolName: string, mcpServerName: string | undefined): string {
  if (mcpServerName) return `${mcpServerName} / ${toolName}`;
  // Strip namespace prefix for display
  const parsed = parseNamespacedTool(toolName);
  if (parsed) return `${parsed.ext} / ${parsed.tool}`;
  return toolName;
}

function summarizeArguments(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  const parts = entries.slice(0, 3).map(([key, value]) => {
    const strVal = typeof value === "string" ? value : JSON.stringify(value);
    const truncated = strVal && strVal.length > 60 ? strVal.slice(0, 57) + "..." : strVal;
    return `${key}: ${truncated}`;
  });
  if (entries.length > 3) parts.push(`+${entries.length - 3} more`);
  return parts.join(", ");
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

function CollapsibleSection({
  label,
  defaultExpanded,
  children,
  copyText,
}: {
  label: string;
  defaultExpanded: boolean;
  children: React.ReactNode;
  copyText?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <span>{label}</span>
      </button>
      {expanded && (
        <div className="mt-1 relative group/collapsible">
          {copyText && (
            <div className="absolute top-1 right-1 opacity-0 group-hover/collapsible:opacity-100 transition-opacity">
              <CopyButton text={copyText} />
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: ToolExecutionBlock["status"] }) {
  switch (status) {
    case "pending":
    case "validating":
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    case "complete":
      return <Check className="h-4 w-4 text-green-500" />;
    case "error":
      return <XCircle className="h-4 w-4 text-destructive" />;
  }
}

function statusLabel(block: ToolExecutionBlock): string {
  switch (block.status) {
    case "pending":
      return "Queued...";
    case "validating":
      return "Checking governance rules...";
    case "running":
      return summarizeArguments(block.arguments);
    case "complete":
      return "";
    case "error":
      return block.error ?? "Tool execution failed";
  }
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface ToolHeaderProps {
  status: ToolExecutionBlock["status"];
  displayName: string;
  label: string;
  duration: number | undefined;
  isExtensionTool: boolean;
}

function ToolHeader({ status, displayName, label, duration, isExtensionTool }: ToolHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <StatusIcon status={status} />
      {isExtensionTool && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-purple-500/10 text-[10px] font-medium text-purple-600 dark:text-purple-400">
          <Puzzle className="h-2.5 w-2.5" />
          ext
        </span>
      )}
      <span className="font-mono text-xs font-medium">{displayName}</span>
      {label && (
        <span className="text-xs text-muted-foreground truncate">{label}</span>
      )}
      {duration != null && status === "complete" && (
        <span className="ml-auto inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground font-mono">
          {formatDuration(duration)}
        </span>
      )}
    </div>
  );
}

interface ToolArgumentsProps {
  block: ToolExecutionBlock;
  isActive: boolean;
}

function ToolArguments({ block, isActive }: ToolArgumentsProps) {
  const hasArguments = Object.keys(block.arguments).length > 0 || block.argumentsStreaming;
  if (!hasArguments) return null;

  const argsDisplay =
    block.argumentsStreaming && isActive
      ? block.argumentsStreaming
      : formatJson(block.arguments);

  return (
    <div className="px-3 pb-2">
      <CollapsibleSection
        label="Arguments"
        defaultExpanded={isActive && !block.isHistorical}
      >
        <pre className="p-2 bg-muted rounded text-[11px] font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
          {argsDisplay}
        </pre>
      </CollapsibleSection>
    </div>
  );
}

interface ToolProgressProps {
  progressMessage: string | undefined;
  partialOutput: string | undefined;
  isActive: boolean;
}

function ToolProgress({ progressMessage, partialOutput, isActive }: ToolProgressProps) {
  if (!isActive) return null;

  return (
    <>
      {progressMessage && (
        <div className="px-3 pb-2">
          <span className="text-xs text-muted-foreground animate-pulse">
            {progressMessage}
          </span>
        </div>
      )}
      {partialOutput && (
        <div className="px-3 pb-2">
          <pre className="p-2 bg-muted rounded text-[11px] font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
            {partialOutput}
          </pre>
        </div>
      )}
    </>
  );
}

interface ToolResultProps {
  block: ToolExecutionBlock;
}

function ToolResult({ block }: ToolResultProps) {
  if (block.status !== "complete" || !block.result) return null;

  const resultText = block.result.detailedContent ?? block.result.content ?? "";

  return (
    <div className="px-3 pb-2">
      <CollapsibleSection
        label="Result"
        defaultExpanded={!block.isHistorical}
        copyText={resultText}
      >
        <pre className="p-2 bg-muted rounded text-[11px] font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
          {resultText}
        </pre>
      </CollapsibleSection>
    </div>
  );
}

interface ToolErrorProps {
  status: ToolExecutionBlock["status"];
  error: string | undefined;
}

function ToolError({ status, error }: ToolErrorProps) {
  if (status !== "error" || !error) return null;

  return (
    <div className="px-3 pb-2">
      <div className="p-2 rounded bg-destructive/10 text-xs text-destructive">
        {error}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ChatToolExecutionProps {
  block: ToolExecutionBlock;
}

export function ChatToolExecution({ block }: ChatToolExecutionProps) {
  const displayName = formatToolName(block.toolName, block.mcpServerName);
  const label = statusLabel(block);
  const isActive = block.status === "pending" || block.status === "validating" || block.status === "running";
  const isExtensionTool = parseNamespacedTool(block.toolName) !== null;

  return (
    <div
      className={cn(
        "rounded-md border text-sm",
        block.status === "error"
          ? "border-destructive/30 bg-destructive/5"
          : "border-border bg-muted/30",
      )}
    >
      <ToolHeader
        status={block.status}
        displayName={displayName}
        label={label}
        duration={block.duration}
        isExtensionTool={isExtensionTool}
      />
      <ToolArguments block={block} isActive={isActive} />
      <ToolProgress
        progressMessage={block.progressMessage}
        partialOutput={block.partialOutput}
        isActive={isActive}
      />
      <ToolResult block={block} />
      <ToolError status={block.status} error={block.error} />
    </div>
  );
}
