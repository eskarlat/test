import { Link } from "react-router";
import {
  CheckCircle2,
  XCircle,
  Info,
  ArrowRight,
  Puzzle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Skeleton } from "../ui/Skeleton";
import { cn } from "../../lib/utils";
import type { MountedExtension } from "../../stores/extension-store";

function StatusBadge({ status }: { status: string }) {
  if (status === "healthy") {
    return (
      <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 dark:bg-green-950 rounded-full px-2 py-0.5 border border-green-200 dark:border-green-800">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        healthy
      </span>
    );
  }
  if (status === "needs-setup" || status === "needs_setup") {
    return (
      <span className="flex items-center gap-1 text-xs text-yellow-600 bg-yellow-50 dark:bg-yellow-950 rounded-full px-2 py-0.5 border border-yellow-200 dark:border-yellow-800">
        <Info className="h-3 w-3" aria-hidden="true" />
        needs setup
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 dark:bg-red-950 rounded-full px-2 py-0.5 border border-red-200 dark:border-red-800">
      <XCircle className="h-3 w-3" aria-hidden="true" />
      error
    </span>
  );
}

interface ExtensionStatusListProps {
  extensions: MountedExtension[];
  projectId: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function ExtensionStatusList({
  extensions,
  projectId,
  loading,
  error,
  onRetry,
}: ExtensionStatusListProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Failed to load extensions: {error}</p>
        </div>
        <button
          onClick={onRetry}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  if (extensions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <Puzzle className="h-6 w-6 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No extensions installed.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card divide-y divide-border">
      {extensions.map((ext) => {
        const firstPage = ext.ui?.pages?.[0];
        const needsSetup = ext.status === "needs-setup" || ext.status === "needs_setup";
        return (
          <div key={ext.name} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-foreground">
                  {ext.displayName ?? ext.name}
                </span>
                <span className="text-xs text-muted-foreground font-mono">v{ext.version}</span>
                <StatusBadge status={ext.status} />
              </div>
              {ext.error && (
                <p className="text-xs text-destructive mt-0.5 truncate">{ext.error}</p>
              )}
            </div>
            {needsSetup && (
              <Link
                to="/extensions"
                className="text-xs text-yellow-600 hover:underline flex-shrink-0"
              >
                Configure
              </Link>
            )}
            {!needsSetup && firstPage && (
              <Link
                to={`/${projectId}/${ext.name}/${firstPage.id}`}
                className={cn(
                  "flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0",
                  ext.status !== "healthy" && "opacity-50 pointer-events-none"
                )}
              >
                Open <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
