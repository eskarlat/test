import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Brain } from "lucide-react";
import { CopyButton } from "./CopyButton";
import type { ReasoningBlock } from "../../types/chat";

// ---------------------------------------------------------------------------
// ReasoningHeader — icon, label, token badge, chevron
// ---------------------------------------------------------------------------

interface ReasoningHeaderProps {
  expanded: boolean;
  hasContent: boolean;
  isStreaming: boolean | undefined;
  tokens: number | undefined;
  onToggle: () => void;
}

function ReasoningHeader({ expanded, hasContent, isStreaming, tokens, onToggle }: ReasoningHeaderProps) {
  const showSpinner = isStreaming && !hasContent;

  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted/80 transition-colors"
    >
      {showSpinner ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
      ) : (
        <Brain className="h-3.5 w-3.5 text-primary/70 flex-shrink-0" />
      )}
      <span className="font-medium text-muted-foreground italic">
        {showSpinner ? "Thinking..." : "Thinking"}
      </span>
      {tokens != null && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground font-mono">
          {tokens.toLocaleString()} tokens
        </span>
      )}
      <span className="ml-auto flex-shrink-0">
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// ReasoningContent — expanded content area with copy button and streaming
// ---------------------------------------------------------------------------

interface ReasoningContentProps {
  content: string;
  hasContent: boolean;
  isStreaming: boolean | undefined;
}

function ReasoningContent({ content, hasContent, isStreaming }: ReasoningContentProps) {
  if (hasContent) {
    return (
      <div className="relative px-3 pb-3 group/reasoning">
        <div className="absolute top-0 right-3 opacity-0 group-hover/reasoning:opacity-100 transition-opacity">
          <CopyButton text={content} />
        </div>
        <div className="text-xs text-muted-foreground italic whitespace-pre-wrap break-words leading-relaxed">
          {content}
        </div>
        {isStreaming && (
          <span className="inline-block w-1.5 h-3 bg-primary/50 animate-pulse ml-0.5" />
        )}
      </div>
    );
  }

  if (isStreaming) {
    return (
      <div className="px-3 pb-3 flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
        <span className="text-xs text-muted-foreground italic">Thinking...</span>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ChatReasoningBlockProps {
  block: ReasoningBlock;
  /** Whether new content is currently being streamed into this block. */
  isStreaming: boolean | undefined;
}

export function ChatReasoningBlock({ block, isStreaming }: ChatReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = block.content.length > 0;

  return (
    <div className="rounded-md border-l-2 border-primary/30 bg-muted/50 text-sm">
      <ReasoningHeader
        expanded={expanded}
        hasContent={hasContent}
        isStreaming={isStreaming}
        tokens={block.tokens}
        onToggle={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <ReasoningContent
          content={block.content}
          hasContent={hasContent}
          isStreaming={isStreaming}
        />
      )}
    </div>
  );
}
