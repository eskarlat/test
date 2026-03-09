import { useState } from "react";
import { Loader2, Check, XCircle, ChevronDown, ChevronRight, Bot } from "lucide-react";
import { cn } from "../../lib/utils";
import { ChatContentBlock } from "./ChatContentBlock";
import { formatDuration } from "./format-duration";
import type { SubagentBlock } from "../../types/chat";

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: SubagentBlock["status"] }) {
  switch (status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-[10px] font-medium text-primary">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          Running
        </span>
      );
    case "complete":
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/10 text-[10px] font-medium text-green-600 dark:text-green-400">
          <Check className="h-2.5 w-2.5" />
          Complete
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-destructive/10 text-[10px] font-medium text-destructive">
          <XCircle className="h-2.5 w-2.5" />
          Failed
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// SubagentHeader — chevron, bot icon, name, status badge, duration
// ---------------------------------------------------------------------------

interface SubagentHeaderProps {
  expanded: boolean;
  onToggle: () => void;
  agentDisplayName: string;
  status: SubagentBlock["status"];
  isFinished: boolean;
  duration: number | undefined;
}

function SubagentHeader({
  expanded,
  onToggle,
  agentDisplayName,
  status,
  isFinished,
  duration,
}: SubagentHeaderProps) {
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 transition-colors"
    >
      <Chevron className="h-3 w-3 text-muted-foreground flex-shrink-0" />
      <Bot className="h-4 w-4 text-primary/70 flex-shrink-0" />
      <span className="text-xs font-medium truncate">
        {agentDisplayName}
      </span>
      <StatusBadge status={status} />
      {duration != null && isFinished && (
        <span className="ml-auto inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground font-mono">
          {formatDuration(duration)}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// SubagentBody — description, error, nested blocks, running indicator
// ---------------------------------------------------------------------------

interface SubagentBodyProps {
  block: SubagentBlock;
  hasNestedBlocks: boolean;
}

function SubagentBody({ block, hasNestedBlocks }: SubagentBodyProps) {
  return (
    <>
      {/* Description */}
      {block.agentDescription && (
        <div className="px-3 pb-1">
          <span className="text-xs text-muted-foreground">{block.agentDescription}</span>
        </div>
      )}

      {/* Error message */}
      {block.status === "failed" && block.error && (
        <div className="px-3 pb-2">
          <div className="p-2 rounded bg-destructive/10 text-xs text-destructive">
            {block.error}
          </div>
        </div>
      )}

      {/* Nested content blocks — rendered recursively */}
      {hasNestedBlocks && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/50 mt-1 pt-2">
          {block.nestedBlocks!.map((nestedBlock, i) => (
            <ChatContentBlock key={i} block={nestedBlock} isStreaming={undefined} />
          ))}
        </div>
      )}

      {/* Running indicator when no nested blocks yet */}
      {block.status === "running" && !hasNestedBlocks && (
        <div className="px-3 pb-3 flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">Agent working...</span>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ChatSubagentBlockProps {
  block: SubagentBlock;
}

export function ChatSubagentBlock({ block }: ChatSubagentBlockProps) {
  const isFinished = block.status === "complete" || block.status === "failed";
  const [expanded, setExpanded] = useState(!isFinished);
  const hasNestedBlocks = block.nestedBlocks != null && block.nestedBlocks.length > 0;

  return (
    <div
      className={cn(
        "rounded-md border text-sm",
        block.status === "failed"
          ? "border-destructive/30 bg-destructive/5"
          : "border-border bg-muted/20",
      )}
    >
      <SubagentHeader
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        agentDisplayName={block.agentDisplayName}
        status={block.status}
        isFinished={isFinished}
        duration={block.duration}
      />
      {expanded && (
        <SubagentBody block={block} hasNestedBlocks={hasNestedBlocks} />
      )}
    </div>
  );
}
