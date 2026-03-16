/**
 * ChatSessionPickerDialog — shown inside empty panes to pick or create a session.
 * ADR-052 §2.2, component tree §3
 */

import { MessageSquare, Plus } from "lucide-react";
import { useChatStore, type ChatState } from "../../stores/chat-store";
import type { SessionMetadata } from "../../types/chat";

const selectSessions = (s: ChatState) => s.sessions;

interface ChatSessionPickerDialogProps {
  onSelect: (sessionId: string) => void;
  onCreateNew: () => void;
}

export function ChatSessionPickerDialog({ onSelect, onCreateNew }: ChatSessionPickerDialogProps) {
  const sessions = useChatStore(selectSessions);

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-xs space-y-3">
        <div className="text-center space-y-1">
          <MessageSquare className="h-8 w-8 text-muted-foreground/50 mx-auto" />
          <p className="text-sm font-medium text-foreground">Choose a session</p>
          <p className="text-xs text-muted-foreground">
            Select an existing session or create a new one.
          </p>
        </div>

        {/* Session list */}
        {sessions.length > 0 && (
          <div className="rounded-lg border border-border bg-card divide-y divide-border max-h-48 overflow-y-auto">
            {sessions.map((s: SessionMetadata) => (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-muted/50 transition-colors"
              >
                <MessageSquare className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <span className="truncate">
                  {s.title ?? `Session ${s.id.slice(0, 8)}`}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground font-mono flex-shrink-0">
                  {s.model.split("/").pop()?.replace("claude-", "") ?? s.model}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Create new */}
        <button
          onClick={onCreateNew}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
        >
          <Plus className="h-3 w-3" />
          New session
        </button>
      </div>
    </div>
  );
}
