import { Server, AlertCircle, RefreshCw } from "lucide-react";
import { Skeleton } from "../ui/Skeleton";
import { useHealth } from "../../api/hooks";

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

export function ServerStatus() {
  const { data: health, loading, error, reload } = useHealth();

  if (loading) {
    return (
      <div className="rounded-lg border border-border p-4 space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>
    );
  }

  if (error || !health) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Server status unavailable{error ? `: ${error}` : ""}
          </p>
        </div>
        <button
          onClick={reload}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          aria-label="Retry"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4 bg-card">
      <div className="flex items-center gap-2 mb-2">
        <Server className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" aria-hidden="true" />
        <span className="text-sm font-semibold text-foreground">Server running</span>
        <span className="ml-auto text-xs text-muted-foreground">port {health.port}</span>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>Uptime: {formatUptime(Math.round(health.uptime))}</span>
        <span>Memory: {formatBytes(health.memoryUsage.heapUsed)}</span>
        {health.pid !== undefined && <span>PID: {health.pid}</span>}
        {health.version && <span>v{health.version}</span>}
      </div>
    </div>
  );
}
