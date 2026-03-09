import { BarChart2, AlertCircle, RefreshCw } from "lucide-react";
import { Skeleton } from "../ui/Skeleton";
import { useAPIUsage, type APIStatRow } from "../../api/hooks";

interface APIUsageProps {
  projectId: string;
}

export function APIUsage({ projectId }: APIUsageProps) {
  const { data: stats, loading, error, reload } = useAPIUsage(projectId);

  if (loading) {
    return (
      <div className="space-y-1">
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
          <p className="text-sm text-muted-foreground">API usage unavailable: {error}</p>
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

  if (!stats || stats.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <BarChart2 className="h-6 w-6 text-muted-foreground mx-auto mb-1.5" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">No API calls in the last hour.</p>
      </div>
    );
  }

  const totalCalls = stats.reduce((sum, r) => sum + r.calls, 0);
  const overallAvg =
    totalCalls > 0
      ? Math.round(stats.reduce((sum, r) => sum + r.avgLatencyMs * r.calls, 0) / totalCalls)
      : 0;

  return (
    <div className="rounded-lg border border-border bg-card divide-y divide-border">
      {stats.slice(0, 8).map((row: APIStatRow, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2 text-xs">
          <span className="font-mono text-foreground flex-shrink-0 truncate max-w-28">
            {row.extension}
          </span>
          <span className="text-muted-foreground truncate flex-1 font-mono">{row.action}</span>
          <span className="font-semibold text-foreground flex-shrink-0 tabular-nums">
            {row.calls} call{row.calls !== 1 ? "s" : ""}
          </span>
          <span className="text-muted-foreground flex-shrink-0 tabular-nums">
            avg {row.avgLatencyMs}ms
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground bg-muted/30">
        <span>{totalCalls} total calls (last hour)</span>
        <span>Overall avg: {overallAvg}ms</span>
      </div>
    </div>
  );
}
