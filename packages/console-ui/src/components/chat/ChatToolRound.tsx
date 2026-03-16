import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { ChatToolExecution } from "./ChatToolExecution";
import { useChatPreferencesStore } from "../../stores/chat-preferences-store";
import type { ContentBlock, ToolExecutionBlock, ToolRound } from "../../types/chat";

// ---------------------------------------------------------------------------
// Utility — group adjacent tool-execution blocks by roundId
// ---------------------------------------------------------------------------

export function groupToolRounds(
  blocks: ContentBlock[],
): (ContentBlock | ToolRound)[] {
  const result: (ContentBlock | ToolRound)[] = [];
  let currentRound: ToolExecutionBlock[] = [];
  let currentRoundId: string | null = null;

  function flushRound(): void {
    if (currentRound.length === 0) return;
    if (currentRound.length === 1 && currentRound[0]) {
      // Single tool — wrap as ToolRound still for consistent typing
      result.push({
        type: "tool-round",
        roundId: currentRound[0].roundId,
        tools: [...currentRound],
      });
    } else {
      result.push({
        type: "tool-round",
        roundId: currentRoundId!,
        tools: [...currentRound],
      });
    }
    currentRound = [];
    currentRoundId = null;
  }

  for (const block of blocks) {
    if (block.type === "tool-execution") {
      if (currentRoundId === null || currentRoundId === block.roundId) {
        currentRoundId = block.roundId;
        currentRound.push(block);
      } else {
        flushRound();
        currentRoundId = block.roundId;
        currentRound.push(block);
      }
    } else {
      flushRound();
      result.push(block);
    }
  }

  flushRound();
  return result;
}

// ---------------------------------------------------------------------------
// Single tool round — no wrapper
// ---------------------------------------------------------------------------

function SingleToolRound({ tool }: { tool: ToolExecutionBlock }) {
  return <ChatToolExecution block={tool} />;
}

// ---------------------------------------------------------------------------
// Multi-tool round — bordered container with expand/collapse
// ---------------------------------------------------------------------------

function isRoundActive(tools: ToolExecutionBlock[]): boolean {
  return tools.some(
    (t) => t.status === "pending" || t.status === "validating" || t.status === "running",
  );
}

function MultiToolRound({ round }: { round: ToolRound }) {
  const mode = useChatPreferencesStore((s) => s.toolDisplayMode);
  const [expanded, setExpanded] = useState(true);
  const active = isRoundActive(round.tools);
  const completeCount = round.tools.filter((t) => t.status === "complete").length;
  const headerText = active
    ? `Running ${round.tools.length} tools`
    : `Ran ${round.tools.length} tools`;

  // Compact mode: summary header + flat list of compact tool lines (ADR-052 §1.3.1)
  if (mode === "compact") {
    return (
      <div className="space-y-0.5">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 w-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 flex-shrink-0" />
          )}
          <Wrench className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium">{headerText}</span>
          {!active && (
            <span className="text-[10px] font-mono">
              {completeCount}/{round.tools.length}
            </span>
          )}
        </button>
        {expanded && (
          <div className="space-y-0.5 pl-2">
            {round.tools.map((tool) => (
              <ChatToolExecution key={tool.toolCallId} block={tool} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border">
      {/* Round header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0" />
        )}
        <Wrench className="h-3 w-3 flex-shrink-0" />
        <span className="font-medium">{headerText}</span>
        {!active && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-muted text-[10px] font-mono">
            {completeCount}/{round.tools.length} complete
          </span>
        )}
      </button>

      {/* Tool list */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {round.tools.map((tool) => (
            <ChatToolExecution key={tool.toolCallId} block={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

interface ChatToolRoundProps {
  round: ToolRound;
}

export function ChatToolRound({ round }: ChatToolRoundProps) {
  if (round.tools.length === 1 && round.tools[0]) {
    return <SingleToolRound tool={round.tools[0]} />;
  }
  return <MultiToolRound round={round} />;
}
