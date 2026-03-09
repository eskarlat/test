import { Wifi, WifiOff, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Skeleton } from "../ui/Skeleton";
import { useMCPStatus, type MCPStatusEntry } from "../../api/hooks";
import { cn } from "../../lib/utils";

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function ConnectionBadge({ status }: { status: MCPStatusEntry["status"] }) {
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1 text-xs text-green-600">
        <Wifi className="h-3 w-3" aria-hidden="true" />
        Connected
      </span>
    );
  }
  if (status === "connecting") {
    return (
      <span className="flex items-center gap-1 text-xs text-blue-600">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Connecting
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-red-600">
      <WifiOff className="h-3 w-3" aria-hidden="true" />
      {status === "error" ? "Error" : "Disconnected"}
    </span>
  );
}

interface MCPStatusProps {
  projectId: string;
}

export function MCPStatus({ projectId }: MCPStatusProps) {
  const { data: mcps, loading, error, reload } = useMCPStatus(projectId);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">MCP status unavailable: {error}</p>
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

  if (!mcps || mcps.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <p className="text-xs text-muted-foreground">No active MCP connections.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card divide-y divide-border">
      {mcps.map((mcp) => (
        <div key={mcp.extensionName} className="flex items-center gap-3 px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground">{mcp.extensionName}</span>
              <span
                className={cn(
                  "text-xs font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                )}
              >
                {mcp.transport}
              </span>
              {mcp.pid !== undefined && (
                <span className="text-xs text-muted-foreground">PID {mcp.pid}</span>
              )}
              {mcp.url && (
                <span className="text-xs text-muted-foreground font-mono truncate max-w-40">
                  {mcp.url}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
              <span>Uptime: {formatUptime(mcp.uptime)}</span>
              {mcp.error && (
                <span className="text-destructive truncate">{mcp.error}</span>
              )}
            </div>
          </div>
          <ConnectionBadge status={mcp.status} />
        </div>
      ))}
    </div>
  );
}
