/**
 * ChatPaneHeader — session selector, close button, notification badges.
 * ADR-052 §2.2
 */

import { X, Circle } from "lucide-react";
import { cn } from "../../lib/utils";
import { useChatStore, type ChatState } from "../../stores/chat-store";
import type { SessionMetadata } from "../../types/chat";

const selectSessions = (s: ChatState) => s.sessions;

interface ChatPaneHeaderProps {
  paneId: string;
  sessionId: string | null;
  isFocused: boolean;
  canClose: boolean;
  isStreaming: boolean;
  hasPendingPermission: boolean;
  onFocus: () => void;
  onClose: () => void;
  onSessionChange: (sessionId: string) => void;
  onNewSession: () => void;
}

export function ChatPaneHeader({
  paneId: _paneId,
  sessionId,
  isFocused,
  canClose,
  isStreaming,
  hasPendingPermission,
  onFocus,
  onClose,
  onSessionChange,
  onNewSession,
}: ChatPaneHeaderProps) {
  const sessions = useChatStore(selectSessions);
  const currentSession = sessions.find((s) => s.id === sessionId);
  const sessionTitle = currentSession?.title ?? (sessionId ? "Untitled" : "No session");

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 border-b text-xs",
        isFocused
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-muted/20",
      )}
      onClick={onFocus}
    >
      {/* Status badges */}
      {isStreaming && (
        <Circle className="h-2 w-2 fill-green-500 text-green-500 flex-shrink-0 animate-pulse" />
      )}
      {hasPendingPermission && !isStreaming && (
        <Circle className="h-2 w-2 fill-amber-500 text-amber-500 flex-shrink-0" />
      )}

      {/* Session selector dropdown */}
      <select
        value={sessionId ?? ""}
        onChange={(e) => {
          const val = e.target.value;
          if (val === "__new__") onNewSession();
          else if (val) onSessionChange(val);
        }}
        className="flex-1 min-w-0 truncate bg-transparent text-foreground text-xs cursor-pointer focus:outline-none"
        title={sessionTitle}
      >
        {!sessionId && (
          <option value="" disabled>
            Select session...
          </option>
        )}
        {sessions.map((s: SessionMetadata) => (
          <option key={s.id} value={s.id}>
            {s.title ?? `Session ${s.id.slice(0, 8)}`}
          </option>
        ))}
        <option value="__new__">+ New session</option>
      </select>

      {/* Model badge */}
      {currentSession && (
        <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">
          {currentSession.model.split("/").pop()?.replace("claude-", "") ?? currentSession.model}
        </span>
      )}

      {/* Close button */}
      {canClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="flex-shrink-0 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
          aria-label="Close pane"
          title="Close pane"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
