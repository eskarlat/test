import { Link } from "react-router";
import { ScrollText, AlertCircle, RefreshCw, ArrowRight } from "lucide-react";
import { Skeleton } from "../ui/Skeleton";
import { useLogs, type LogEntry } from "../../api/hooks";
import { cn } from "../../lib/utils";

const levelColors: Record<string, string> = {
  info: "text-blue-600 dark:text-blue-400",
  warn: "text-yellow-600 dark:text-yellow-400",
  error: "text-red-600 dark:text-red-400",
  debug: "text-muted-foreground",
};

interface RecentLogsProps {
  projectId: string;
}

export function RecentLogs({ projectId }: RecentLogsProps) {
  const { data: logs, loading, error, reload } = useLogs(projectId, 10);

  if (loading) {
    return (
      <div className="space-y-1">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-3/4" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Logs unavailable: {error}</p>
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

  if (!logs || logs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <ScrollText className="h-6 w-6 text-muted-foreground mx-auto mb-1.5" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">No log entries yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="divide-y divide-border font-mono text-xs">
        {logs.slice(0, 10).map((entry: LogEntry, i) => (
          <div key={i} className="flex items-start gap-2 px-3 py-1.5 odd:bg-muted/20">
            <span className="text-muted-foreground tabular-nums flex-shrink-0 whitespace-nowrap">
              {new Date(entry.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            <span
              className={cn("uppercase text-xs font-semibold flex-shrink-0 w-10", levelColors[entry.level])}
            >
              {entry.level}
            </span>
            <span className="text-muted-foreground flex-shrink-0 max-w-20 truncate">{entry.source}</span>
            <span className="text-foreground truncate min-w-0">{entry.message}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end px-3 py-2 border-t border-border bg-muted/20">
        <Link
          to="/logs"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all logs <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
