import { useRef, useEffect, useState, type KeyboardEvent, type ChangeEvent } from "react";
import { Send, Square, Paperclip, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { useChatStore } from "../../stores/chat-store";
import type { Attachment } from "../../types/chat";

const MAX_HEIGHT = 200;

function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (index: number) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {attachments.map((att, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground"
        >
          {att.type === "file" ? "📄" : "📁"}
          {att.displayName ?? "attachment"}
          <button
            onClick={() => onRemove(i)}
            className="p-0.5 rounded-full hover:bg-accent"
            aria-label="Remove attachment"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
    </div>
  );
}

function ActionButton({
  isStreaming,
  canSend,
  onSend,
  onStop,
}: {
  isStreaming: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  if (isStreaming) {
    return (
      <button
        onClick={onStop}
        className="p-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
        aria-label="Stop generation"
      >
        <Square className="h-4 w-4" />
      </button>
    );
  }
  return (
    <button
      onClick={onSend}
      disabled={!canSend}
      className={cn(
        "p-2 rounded-md transition-colors",
        canSend
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "bg-muted text-muted-foreground cursor-not-allowed",
      )}
      aria-label="Send message"
    >
      <Send className="h-4 w-4" />
    </button>
  );
}

export function ChatInput() {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const bridgeStatus = useChatStore((s) => s.bridgeStatus);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const cancelGeneration = useChatStore((s) => s.cancelGeneration);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const models = useChatStore((s) => s.models);

  const revisionDraft = useChatStore((s) => s.revisionDraft);

  const disabled = bridgeStatus !== "ready" || !activeSessionId;
  const canSend = !disabled && text.trim().length > 0 && !isStreaming;
  const currentModel = models.find((m) => m.id === selectedModel);
  const showAttachBtn = currentModel?.supportsVision ?? false;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus();
  }, [disabled, activeSessionId]);

  // Consume revision draft from store (Up arrow or pencil click)
  useEffect(() => {
    if (revisionDraft !== null) {
      setText(revisionDraft);
      useChatStore.setState({ revisionDraft: null, revisionSourceIndex: null });
      textareaRef.current?.focus();
    }
  }, [revisionDraft]);

  function handleSend(): void {
    if (!canSend) return;
    sendMessage(text.trim(), attachments.length > 0 ? attachments : undefined);
    setText("");
    setAttachments([]);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) handleSend();
    }
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>): void {
    setText(e.target.value);
  }

  function handleFileAttach(): void {
    const path = window.prompt("Enter file or directory path:");
    if (!path) return;
    const isDir = path.endsWith("/");
    const name = path.split("/").filter(Boolean).pop() ?? path;
    const att: Attachment = isDir
      ? { type: "directory", path, displayName: name }
      : { type: "file", path, displayName: name };
    setAttachments((prev) => [...prev, att]);
  }

  function removeAttachment(index: number): void {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="border-t border-border bg-background px-2 md:px-4 py-2 md:py-3">
      <AttachmentChips attachments={attachments} onRemove={removeAttachment} />

      <div className="flex items-end gap-2">
        {showAttachBtn && (
          <button
            onClick={handleFileAttach}
            disabled={disabled}
            className={cn(
              "p-2 rounded-md transition-colors",
              disabled
                ? "text-muted-foreground/50 cursor-not-allowed"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
            aria-label="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </button>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={disabled ? "Chat not available" : "Type a message..."}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-md border border-border bg-muted/50 px-3 py-2 text-sm",
            "placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring",
            disabled && "cursor-not-allowed opacity-50",
          )}
        />

        <ActionButton
          isStreaming={isStreaming}
          canSend={canSend}
          onSend={handleSend}
          onStop={cancelGeneration}
        />
      </div>
    </div>
  );
}
