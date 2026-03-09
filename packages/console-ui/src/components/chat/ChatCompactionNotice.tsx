import { Loader2, Minimize2 } from "lucide-react";
import type { CompactionBlock } from "../../types/chat";

interface ChatCompactionNoticeProps {
  block: CompactionBlock;
}

/**
 * Inline notice displayed when the conversation context is compacted.
 * Shows a spinner while compaction is in progress (tokensRemoved === 0),
 * or a summary once compaction is complete.
 */
export function ChatCompactionNotice({ block }: ChatCompactionNoticeProps) {
  const isInProgress = block.tokensRemoved === 0;

  return (
    <div className="flex items-center gap-2 border-y border-border py-2 my-2 text-xs text-muted-foreground select-none">
      {isInProgress ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          <span>Compacting conversation history...</span>
        </>
      ) : (
        <>
          <Minimize2 className="h-3 w-3 shrink-0" />
          <span>
            Compacted &mdash; removed{" "}
            {block.tokensRemoved.toLocaleString()} tokens
          </span>
          {block.summary && (
            <span className="ml-1 italic truncate" title={block.summary}>
              &middot; {block.summary}
            </span>
          )}
        </>
      )}
    </div>
  );
}
