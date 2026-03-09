import { useEffect, useRef, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useChatStore, type ChatState } from "../../stores/chat-store";
import { ChatMessage } from "./ChatMessage";
import { ChatNewMessageIndicator } from "./ChatNewMessageIndicator";
import { groupToolRounds } from "./ChatToolRound";
import type { ChatMessage as ChatMessageType, ContentBlock, ToolRound } from "../../types/chat";

const SCROLL_THRESHOLD = 50;
const VIRTUALIZATION_THRESHOLD = 100;
const EMPTY_MESSAGES: ChatMessageType[] = [];

// Top-level stable selectors
const selectIsStreaming = (s: ChatState) => s.isStreaming;
const selectStreamingContent = (s: ChatState) => s.streamingContent;
const selectStreamingReasoning = (s: ChatState) => s.streamingReasoning;
const selectIsUserScrolledUp = (s: ChatState) => s.isUserScrolledUp;
const selectHasNewMessages = (s: ChatState) => s.hasNewMessages;
const selectSetUserScrolledUp = (s: ChatState) => s.setUserScrolledUp;
const selectScrollToBottom = (s: ChatState) => s.scrollToBottom;
const selectReviseTo = (s: ChatState) => s.reviseTo;

// ---------------------------------------------------------------------------
// Height estimation for virtualizer
// ---------------------------------------------------------------------------

function estimateBlockHeight(block: ContentBlock | ToolRound): number {
  if (block.type === "tool-round") return 120 * block.tools.length;
  if (block.type === "tool-execution") return 120;
  if (block.type === "file-diff") return 200;
  if (block.type === "reasoning") return 60;
  if (block.type === "subagent") return 150;
  if (block.type === "terminal") return 140;
  if (block.type === "text") return 80;
  return 60;
}

function estimateMessageHeight(msg: ChatMessageType): number {
  const grouped = groupToolRounds(msg.blocks);
  let height = 40; // avatar + padding
  for (const block of grouped) {
    height += estimateBlockHeight(block);
  }
  return height;
}

// ---------------------------------------------------------------------------
// Build display messages — merge streaming content into last assistant msg
// ---------------------------------------------------------------------------

function buildDisplayMessages(
  messages: ChatMessageType[],
  isStreaming: boolean,
  streamingContent: string,
  streamingReasoning: string,
): ChatMessageType[] {
  const display = [...messages];
  if (!isStreaming) return display;

  const blocks: ContentBlock[] = [];
  if (streamingReasoning) {
    blocks.push({ type: "reasoning", content: streamingReasoning, collapsed: false });
  }
  if (streamingContent) {
    blocks.push({ type: "text", content: streamingContent });
  }

  // Even with no buffered content yet, ensure the last assistant message stays
  // marked as streaming so the cursor/pulse indicator keeps rendering.
  const last = display[display.length - 1];
  if (last?.role === "assistant" && last.isStreaming) {
    if (blocks.length > 0) {
      display[display.length - 1] = { ...last, blocks: [...last.blocks, ...blocks] };
    }
  } else if (blocks.length > 0) {
    display.push({
      id: "streaming",
      role: "assistant",
      blocks,
      timestamp: new Date().toISOString(),
      isStreaming: true,
    });
  }
  return display;
}

// ---------------------------------------------------------------------------
// Non-virtualized message list (< VIRTUALIZATION_THRESHOLD messages)
// ---------------------------------------------------------------------------

function SimpleMessageList({
  messages,
  onRevise,
}: {
  messages: ChatMessageType[];
  onRevise: (index: number) => void;
}) {
  return (
    <>
      {messages.map((msg, i) => (
        <ChatMessage
          key={msg.id}
          message={msg}
          onRevise={msg.role === "user" ? () => onRevise(i) : undefined}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Virtualized message list (>= VIRTUALIZATION_THRESHOLD messages)
// ---------------------------------------------------------------------------

function VirtualizedMessageList({
  messages,
  scrollRef,
  onRevise,
}: {
  messages: ChatMessageType[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onRevise: (index: number) => void;
}) {
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateMessageHeight(messages[index]!),
    overscan: 5,
  });

  return (
    <div
      className="relative w-full"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const msg = messages[virtualItem.index]!;
        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${virtualItem.start}px)` }}
          >
            <div className="py-3">
              <ChatMessage
                message={msg}
                onRevise={msg.role === "user" ? () => onRevise(virtualItem.index) : undefined}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

interface ChatMessageListProps {
  sessionId: string;
}

export function ChatMessageList({ sessionId }: ChatMessageListProps) {
  const messages = useChatStore((s) => s.messages.get(sessionId) ?? EMPTY_MESSAGES);
  const isStreaming = useChatStore(selectIsStreaming);
  const streamingContent = useChatStore(selectStreamingContent);
  const streamingReasoning = useChatStore(selectStreamingReasoning);
  const isUserScrolledUp = useChatStore(selectIsUserScrolledUp);
  const hasNewMessages = useChatStore(selectHasNewMessages);
  const setUserScrolledUp = useChatStore(selectSetUserScrolledUp);
  const scrollToBottom = useChatStore(selectScrollToBottom);
  const reviseTo = useChatStore(selectReviseTo);

  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const checkScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_THRESHOLD;
    isAtBottomRef.current = atBottom;
    setUserScrolledUp(!atBottom);
  }, [setUserScrolledUp]);

  useEffect(() => {
    if (!isAtBottomRef.current) return;
    sentinelRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent]);

  useEffect(() => {
    if (isStreaming && !isAtBottomRef.current) {
      sentinelRef.current?.scrollIntoView({ behavior: "smooth" });
      isAtBottomRef.current = true;
      setUserScrolledUp(false);
    }
  }, [isStreaming, setUserScrolledUp]);

  function handleScrollToBottom(): void {
    sentinelRef.current?.scrollIntoView({ behavior: "smooth" });
    scrollToBottom();
  }

  function handleRevise(index: number): void {
    reviseTo(index);
  }

  const displayMessages = useMemo(
    () => buildDisplayMessages(messages, isStreaming, streamingContent, streamingReasoning),
    [messages, isStreaming, streamingContent, streamingReasoning],
  );

  const useVirtualization = displayMessages.length >= VIRTUALIZATION_THRESHOLD;

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        onScroll={checkScroll}
        className="h-full overflow-y-auto px-4 py-6 space-y-6"
      >
        {useVirtualization ? (
          <VirtualizedMessageList
            messages={displayMessages}
            scrollRef={containerRef}
            onRevise={handleRevise}
          />
        ) : (
          <SimpleMessageList
            messages={displayMessages}
            onRevise={handleRevise}
          />
        )}
        <div ref={sentinelRef} aria-hidden="true" />
      </div>

      {hasNewMessages && isUserScrolledUp && (
        <ChatNewMessageIndicator onClick={handleScrollToBottom} />
      )}
    </div>
  );
}
