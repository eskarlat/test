import { Zap, CheckCircle2, XCircle, AlertCircle, RefreshCw } from "lucide-react";
import { Skeleton } from "../ui/Skeleton";
import { useHookActivity, type HookActivityEntry } from "../../api/hooks";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface HookActivityProps {
  projectId: string;
}

export function HookActivity({ projectId }: HookActivityProps) {
  const { data: activity, loading, error, reload } = useHookActivity(projectId);

  if (loading) {
    return (
      <div className="space-y-1">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Hook activity unavailable: {error}</p>
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

  if (!activity || activity.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <Zap className="h-6 w-6 text-muted-foreground mx-auto mb-1.5" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">No hook executions recorded yet.</p>
      </div>
    );
  }

  const recent = activity.slice(0, 10);

  return (
    <div className="rounded-lg border border-border bg-card divide-y divide-border">
      {recent.map((entry: HookActivityEntry, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2 text-xs">
          <span className="text-muted-foreground font-mono tabular-nums flex-shrink-0">
            {new Date(entry.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          <span className="flex-shrink-0 font-medium text-foreground truncate max-w-36">
            {entry.event}
          </span>
          {entry.extensionName && (
            <span className="text-muted-foreground flex-shrink-0 font-mono truncate max-w-28">
              {entry.extensionName}
            </span>
          )}
          <span className="flex-1 text-muted-foreground font-mono truncate">{entry.feature}</span>
          {entry.success ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" aria-label="Success" />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" aria-label="Failed" />
          )}
          <span className="text-muted-foreground flex-shrink-0 tabular-nums">
            {formatDuration(entry.durationMs)}
          </span>
        </div>
      ))}
    </div>
  );
}
