import { Users, AlertCircle, RefreshCw } from "lucide-react";
import { Skeleton } from "../ui/Skeleton";
import { useSessions, type ActiveSession } from "../../api/hooks";

function formatRelativeTime(isoStr: string): string {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  return `${h}h ${diffMin % 60}m ago`;
}

function sessionAgentLabel(session: ActiveSession): string {
  const map: Record<string, string> = {
    "claude-code": "Claude Code",
    copilot: "GitHub Copilot",
    cursor: "Cursor",
    windsurf: "Windsurf",
    continue: "Continue",
  };
  return map[session.agent] ?? session.agent;
}

interface SessionListProps {
  projectId: string;
}

export function SessionList({ projectId }: SessionListProps) {
  const { data: sessions, loading, error, reload } = useSessions(projectId);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Sessions unavailable: {error}</p>
        </div>
        <button
          onClick={reload}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <Users className="h-6 w-6 text-muted-foreground mx-auto mb-1.5" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">No active sessions.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card divide-y divide-border">
      {sessions.map((session) => (
        <div key={session.id} className="flex items-center gap-3 px-4 py-3">
          <Users className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-foreground">
              {sessionAgentLabel(session)}
            </span>
            <span className="ml-2 text-xs text-muted-foreground font-mono truncate">
              {session.id}
            </span>
          </div>
          <span className="text-xs text-muted-foreground flex-shrink-0">
            started {formatRelativeTime(session.startedAt)}
          </span>
        </div>
      ))}
    </div>
  );
}
