import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Plus, MoreHorizontal, Trash2, Pencil } from "lucide-react";
import { cn } from "../../lib/utils";
import { useChatStore } from "../../stores/chat-store";
import { Skeleton } from "../ui/Skeleton";
import type { SessionMetadata } from "../../types/chat";

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString();
}

function SessionSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="space-y-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

interface SessionItemProps {
  session: SessionMetadata;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}

function SessionItem({ session, isActive, onSelect, onDelete, onRename }: SessionItemProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title ?? "");
  const menuRef = useRef<HTMLDivElement>(null);

  function handleRenameSubmit(): void {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== session.title) {
      onRename(trimmed);
    }
    setIsRenaming(false);
  }

  if (isRenaming) {
    return (
      <div className="px-3 py-2">
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRenameSubmit();
            if (e.key === "Escape") setIsRenaming(false);
          }}
          className="w-full px-2 py-1 text-sm rounded border border-border bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    );
  }

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left px-3 py-2 rounded-md text-sm transition-colors group relative",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="truncate font-medium">
          {session.title ?? "New Chat"}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu((v) => !v);
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent transition-opacity"
          aria-label="Session actions"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">
        {formatTime(session.lastMessageAt ?? session.createdAt)}
      </div>
      {session.branchedFrom && (
        <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate italic">
          Branched from previous session
        </div>
      )}

      {showMenu && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-1 z-10 bg-popover border border-border rounded-md shadow-md py-1 min-w-[120px]"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(false);
              setRenameValue(session.title ?? "");
              setIsRenaming(true);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors"
          >
            <Pencil className="h-3 w-3" />
            Rename
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(false);
              onDelete();
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-destructive hover:bg-accent transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>
      )}
    </button>
  );
}

interface ChatSessionListProps {
  loading: boolean;
}

export function ChatSessionList({ loading }: ChatSessionListProps) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const renameSession = useChatStore((s) => s.renameSession);

  function handleNewChat(): void {
    if (!projectId) return;
    // Navigate to empty chat view — session created on first message send
    useChatStore.setState({ activeSessionId: null });
    navigate(`/${projectId}/chat`);
  }

  function handleSelect(sessionId: string): void {
    if (!projectId) return;
    navigate(`/${projectId}/chat/${sessionId}`);
  }

  function handleDelete(sessionId: string): void {
    if (!projectId) return;
    deleteSession(projectId, sessionId);
  }

  if (loading) return <SessionSkeleton />;

  const sorted = [...sessions].sort((a, b) => {
    const aTime = a.lastMessageAt ?? a.createdAt ?? "";
    const bTime = b.lastMessageAt ?? b.createdAt ?? "";
    return bTime.localeCompare(aTime);
  });

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <button
          onClick={handleNewChat}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {sorted.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">
            No chat sessions yet
          </p>
        )}
        {sorted.map((session) => (
          <SessionItem
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            onSelect={() => handleSelect(session.id)}
            onDelete={() => handleDelete(session.id)}
            onRename={(title) => renameSession(session.id, title)}
          />
        ))}
      </div>
    </div>
  );
}
