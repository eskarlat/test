import { useState, useEffect, useCallback, useRef } from "react";
import { X, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { apiGet } from "../../api/client";
import type { ExtensionCronJobRun } from "../../types/automation";

interface ExtensionJobLogsModalProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  jobName: string;
  projectId: string;
}

const PAGE_SIZE = 20;

function formatTimestamp(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function statusDotColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-green-500";
    case "running":
      return "bg-blue-500";
    case "failed":
    case "timed_out":
      return "bg-red-500";
    default:
      return "bg-muted-foreground/50";
  }
}

// ---------------------------------------------------------------------------
// RunRow — single row in the run history table
// ---------------------------------------------------------------------------

function RunRow({ run }: { run: ExtensionCronJobRun }) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto_1fr] gap-x-4 gap-y-0 items-center py-2 border-b border-border/50 text-xs">
      <span className="flex items-center gap-1.5">
        <span className={cn("inline-block h-2 w-2 rounded-full", statusDotColor(run.status))} />
        <span className="capitalize">{run.status}</span>
      </span>
      <span className="text-muted-foreground">{formatTimestamp(run.startedAt)}</span>
      <span className="text-muted-foreground tabular-nums">{formatDuration(run.durationMs)}</span>
      <span className="text-muted-foreground">
        {run.completedAt ? formatTimestamp(run.completedAt) : "-"}
      </span>
      <span className={cn("truncate", run.error ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
        {run.error ?? "-"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunTable — table of runs with loading/error/empty states
// ---------------------------------------------------------------------------

function RunTable({ runs, loading, error }: { runs: ExtensionCronJobRun[]; loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="ml-2 text-sm text-muted-foreground">Loading runs...</span>
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400 py-4">{error}</p>;
  }

  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No run history available.</p>;
  }

  return (
    <div className="space-y-0">
      <div className="grid grid-cols-[auto_1fr_auto_auto_1fr] gap-x-4 gap-y-0 text-xs font-medium text-muted-foreground pb-2 border-b border-border">
        <span>Status</span>
        <span>Started</span>
        <span>Duration</span>
        <span>Completed</span>
        <span>Error</span>
      </div>
      {runs.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExtensionJobLogsModal
// ---------------------------------------------------------------------------

export function ExtensionJobLogsModal({
  open,
  onClose,
  jobId,
  jobName,
  projectId,
}: ExtensionJobLogsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [runs, setRuns] = useState<ExtensionCronJobRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const fetchRuns = useCallback(async (pageNum: number) => {
    setLoading(true);
    setError(null);
    const offset = pageNum * PAGE_SIZE;
    const res = await apiGet<ExtensionCronJobRun[]>(
      `/api/${projectId}/ext-cron/${jobId}/runs?limit=${PAGE_SIZE}&offset=${offset}`,
    );
    if (res.data) {
      setRuns(res.data);
      setHasMore(res.data.length === PAGE_SIZE);
    } else {
      setError(res.error ?? "Failed to load run history");
      setRuns([]);
      setHasMore(false);
    }
    setLoading(false);
  }, [projectId, jobId]);

  // Fetch on open and page change
  useEffect(() => {
    if (open) {
      setPage(0);
      fetchRuns(0);
    }
  }, [open, fetchRuns]);

  useEffect(() => {
    if (open && page > 0) {
      fetchRuns(page);
    }
  }, [open, page, fetchRuns]);

  // Focus dialog on open
  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const showPagination = !loading && !error && (runs.length > 0 || page > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Logs for ${jobName}`}
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate">Run History</h2>
            <p className="text-xs text-muted-foreground truncate">{jobName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-5 py-4">
          <RunTable runs={runs} loading={loading} error={error} />
        </div>

        {/* Pagination footer */}
        {showPagination && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border flex-shrink-0">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
                "bg-accent text-accent-foreground hover:bg-accent/80 transition-colors",
                page === 0 && "opacity-50 cursor-not-allowed",
              )}
            >
              <ChevronLeft className="h-3 w-3" aria-hidden="true" />
              Previous
            </button>
            <span className="text-xs text-muted-foreground">Page {page + 1}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
                "bg-accent text-accent-foreground hover:bg-accent/80 transition-colors",
                !hasMore && "opacity-50 cursor-not-allowed",
              )}
            >
              Next
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
