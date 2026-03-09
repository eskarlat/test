import { ChatTextBlock } from "./ChatTextBlock";
import { ChatReasoningBlock } from "./ChatReasoningBlock";
import { ChatToolExecution } from "./ChatToolExecution";
import { ChatSubagentBlock } from "./ChatSubagentBlock";
import { ChatFileDiff } from "./ChatFileDiff";
import { ChatPermissionDialog } from "./ChatPermissionDialog";
import { ChatCompactionNotice } from "./ChatCompactionNotice";
import { ChatProgressIndicator } from "./ChatProgressIndicator";
import { ChatTerminalBlock } from "./ChatTerminalBlock";
import type { ContentBlock, WarningBlock, ImageBlock } from "../../types/chat";

// ---------------------------------------------------------------------------
// Inline block renderers (keep switch arms thin)
// ---------------------------------------------------------------------------

function WarningBlockView({ block }: { block: WarningBlock }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-sm">
      <span className="text-yellow-500 flex-shrink-0">⚠</span>
      <span className="text-yellow-700 dark:text-yellow-300">{block.message}</span>
    </div>
  );
}

function ImageBlockView({ block }: { block: ImageBlock }) {
  return (
    <div className="my-2">
      <img
        src={`data:${block.mimeType};base64,${block.data}`}
        alt={block.alt ?? "Chat image"}
        className="max-w-full rounded-md border border-border"
      />
    </div>
  );
}

function UnknownBlockView({ block }: { block: ContentBlock }) {
  return (
    <details className="text-xs text-muted-foreground py-1">
      <summary className="cursor-pointer">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-mono">
          {block.type}
        </span>
      </summary>
      <pre className="mt-1 p-2 bg-muted rounded text-[10px] overflow-x-auto">
        {JSON.stringify(block, null, 2)}
      </pre>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

interface ChatContentBlockProps {
  block: ContentBlock;
  /** Whether this block is currently receiving streaming content. */
  isStreaming: boolean | undefined;
}

/**
 * Discriminated block renderer — dispatches on block.type.
 */
export function ChatContentBlock({ block, isStreaming }: ChatContentBlockProps) {
  switch (block.type) {
    case "text":
      return <ChatTextBlock content={block.content} />;
    case "reasoning":
      return <ChatReasoningBlock block={block} isStreaming={isStreaming} />;
    case "tool-execution":
      return <ChatToolExecution block={block} />;
    case "subagent":
      return <ChatSubagentBlock block={block} />;
    case "file-diff":
      return <ChatFileDiff block={block} />;
    case "confirmation":
      return <ChatPermissionDialog block={block} />;
    case "compaction":
      return <ChatCompactionNotice block={block} />;
    case "progress":
      return <ChatProgressIndicator message={block.message} />;
    case "warning":
      return <WarningBlockView block={block} />;
    case "image":
      return <ImageBlockView block={block} />;
    case "terminal":
      return <ChatTerminalBlock block={block} />;
    default:
      return <UnknownBlockView block={block} />;
  }
}
