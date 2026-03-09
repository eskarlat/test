import { User, Bot, Pencil } from "lucide-react";
import { cn } from "../../lib/utils";
import { CopyButton } from "./CopyButton";
import { ChatContentBlock } from "./ChatContentBlock";
import { ChatToolRound, groupToolRounds } from "./ChatToolRound";
import type { ChatMessage as ChatMessageType, Attachment, ContentBlock, ToolRound } from "../../types/chat";

function getAttachmentIcon(type: string): string {
  if (type === "file") return "📄";
  if (type === "directory") return "📁";
  return "📝";
}

function getAttachmentLabel(att: Attachment): string {
  if ("path" in att && att.path) return att.path.split("/").pop() ?? att.path;
  return "selection";
}

function AttachmentChips({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-1">
      {attachments.map((att, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground"
        >
          {getAttachmentIcon(att.type)}
          {att.displayName ?? getAttachmentLabel(att)}
        </span>
      ))}
    </div>
  );
}

function extractTextContent(message: ChatMessageType): string {
  return message.blocks
    .filter((b): b is { type: "text"; content: string } => b.type === "text")
    .map((b) => b.content)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Block rendering — dispatches tool-round groups vs individual blocks
// ---------------------------------------------------------------------------

function renderGroupedBlock(item: ContentBlock | ToolRound, index: number): React.ReactNode {
  if (item.type === "tool-round") {
    return <ChatToolRound key={`round-${item.roundId}-${index}`} round={item} />;
  }
  return <ChatContentBlock key={index} block={item} isStreaming={undefined} />;
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

function MessageAvatar({ isUser }: { isUser: boolean }) {
  if (isUser) {
    return (
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center">
        <User className="h-4 w-4 text-accent-foreground" />
      </div>
    );
  }
  return (
    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
      <Bot className="h-4 w-4 text-primary" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Footer (timestamp, copy, edit)
// ---------------------------------------------------------------------------

function MessageFooter({
  timestamp,
  textContent,
  isUser,
  onRevise,
}: {
  timestamp: string;
  textContent: string;
  isUser: boolean;
  onRevise: (() => void) | undefined;
}) {
  return (
    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
      <span className="text-xs text-muted-foreground">
        {new Date(timestamp).toLocaleTimeString()}
      </span>
      {textContent && <CopyButton text={textContent} />}
      {isUser && onRevise && (
        <button
          onClick={onRevise}
          className="p-1 rounded hover:bg-accent transition-colors"
          aria-label="Edit message"
        >
          <Pencil className="h-3 w-3 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ChatMessageProps {
  message: ChatMessageType;
  onRevise: (() => void) | undefined;
}

export function ChatMessage({ message, onRevise }: ChatMessageProps) {
  const isUser = message.role === "user";
  const grouped = groupToolRounds(message.blocks);
  const textContent = extractTextContent(message);

  return (
    <div className={cn("flex gap-3 group", isUser ? "justify-end" : "justify-start")}>
      {!isUser && <MessageAvatar isUser={false} />}

      <div className={cn("max-w-[90%] md:max-w-[80%] space-y-2", isUser && "items-end")}>
        {message.attachments && message.attachments.length > 0 && (
          <AttachmentChips attachments={message.attachments} />
        )}

        <div
          className={cn(
            "rounded-lg px-4 py-3",
            isUser ? "bg-blue-600 text-white dark:bg-blue-500" : "bg-muted/50",
          )}
        >
          {grouped.map((item, i) => renderGroupedBlock(item, i))}
          {message.isStreaming && (
            <span className="inline-block w-2 h-4 bg-current animate-pulse ml-0.5" />
          )}
        </div>

        <MessageFooter
          timestamp={message.timestamp}
          textContent={textContent}
          isUser={isUser}
          onRevise={onRevise}
        />
      </div>

      {isUser && <MessageAvatar isUser />}
    </div>
  );
}
