import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { ArrowLeft, Timer, Loader2, ChevronDown, RefreshCw } from "lucide-react";
import { cn } from "../lib/utils";
import { apiGet } from "../api/client";
import { useAutomationStore, type AutomationStore } from "../stores/automation-store";
import { Skeleton } from "../components/ui/Skeleton";
import { RunStatusBadge } from "../components/automations/RunStatusBadge";
import type { AutomationRun } from "../types/automation";

// ---------------------------------------------------------------------------
// Stable selectors
// ---------------------------------------------------------------------------

const selectRuns = (s: AutomationStore) => s.runs;
const selectRunLoading = (s: AutomationStore) => s.runLoading;
const selectFetchRuns = (s: AutomationStore) => s.fetchRuns;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

const statusFilterOptions = [
  { value: "all", label: "All Statuses" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "timed_out", label: "Timed Out" },
];

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) {
    const mins = Math.floor(diffMs / 60_000);
    return `${mins}m ago`;
  }
  if (diffMs < 86_400_000) {
    const hours = Math.floor(diffMs / 3_600_000);
    return `${hours}h ago`;
  }
  const days = Math.floor(diffMs / 86_400_000);
  return `${days}d ago`;
}

function formatAbsoluteTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function triggerLabel(trigger: string): string {
  return trigger === "scheduled" ? "Scheduled" : "Manual";
}

// ---------------------------------------------------------------------------
// RunCard — single run in the list
// ---------------------------------------------------------------------------

interface RunCardProps {
  run: AutomationRun;
  index: number;
  projectId: string;
  automationId: string;
}

function RunCard({ run, index, projectId, automationId }: RunCardProps) {
  const navigate = useNavigate();
  const totalTokens = run.totalInputTokens + run.totalOutputTokens;

  const handleDetails = useCallback(() => {
    navigate(`/${projectId}/automations/${automationId}/runs/${run.id}`);
  }, [navigate, projectId, automationId, run.id]);

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4 space-y-3 transition-shadow hover:shadow-sm",
        run.status === "running" && "border-blue-500/30",
      )}
    >
      {/* Top row: run number, status, trigger, timestamp */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold tabular-nums">Run #{index + 1}</span>
        <RunStatusBadge status={run.status} />
        <span className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
          run.triggerType === "scheduled"
            ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
            : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
        )}>
          {triggerLabel(run.triggerType)}
        </span>
        <span className="ml-auto text-xs text-muted-foreground" title={formatAbsoluteTime(run.startedAt)}>
          {formatRelativeTime(run.startedAt)}
        </span>
      </div>

      {/* Metadata row */}
      <RunCardMetadata run={run} totalTokens={totalTokens} />

      {/* Error row */}
      {run.error && (
        <p className="text-xs text-red-600 dark:text-red-400 truncate">
          Error: {run.error}
        </p>
      )}

      {/* Worktree row */}
      {run.worktree && (
        <p className="text-xs text-muted-foreground truncate">
          Worktree: {run.worktree.branch} ({run.worktree.status})
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{formatAbsoluteTime(run.startedAt)}</span>
        <button
          onClick={handleDetails}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
            "bg-accent text-accent-foreground hover:bg-accent/80 transition-colors",
          )}
        >
          Details
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunCardMetadata — extracted to keep complexity low
// ---------------------------------------------------------------------------

function RunCardMetadata({ run, totalTokens }: { run: AutomationRun; totalTokens: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>Duration: <span className="font-medium text-foreground tabular-nums">{formatDuration(run.durationMs)}</span></span>
      <span>Steps: <span className="font-medium text-foreground tabular-nums">{run.stepsCompleted}/{run.stepCount}</span></span>
      <span>Tokens: <span className="font-medium text-foreground tabular-nums">{totalTokens.toLocaleString()}</span></span>
      {run.status === "running" && <LiveDurationCounter startedAt={run.startedAt} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LiveDurationCounter — shows elapsed time for running automations
// ---------------------------------------------------------------------------

function LiveDurationCounter({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - new Date(startedAt).getTime());

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - new Date(startedAt).getTime());
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <span className="text-blue-600 dark:text-blue-400 animate-pulse tabular-nums">
      {formatDuration(elapsed)} elapsed
    </span>
  );
}

// ---------------------------------------------------------------------------
// RunListSkeleton
// ---------------------------------------------------------------------------

function RunListSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-16" />
          </div>
          <div className="flex gap-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-4 w-32" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="rounded-lg border border-border border-dashed p-12 text-center space-y-3">
      <Timer className="h-10 w-10 mx-auto text-muted-foreground/50" aria-hidden="true" />
      <h3 className="text-base font-medium">
        {hasFilter ? "No runs match this filter" : "No runs yet"}
      </h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        {hasFilter
          ? "Try changing the status filter or trigger a new run."
          : "Trigger a manual run or wait for a scheduled run to appear here."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusFilter
// ---------------------------------------------------------------------------

interface StatusFilterProps {
  value: string;
  onChange: (value: string) => void;
}

function StatusFilter({ value, onChange }: StatusFilterProps) {
  return (
    <div className="relative inline-flex">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "appearance-none rounded-md border border-border bg-background pl-3 pr-8 py-1.5 text-xs font-medium",
          "focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors",
        )}
      >
        {statusFilterOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" aria-hidden="true" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunList — sorted with running automations on top
// ---------------------------------------------------------------------------

function sortRunsWithRunningFirst(runs: AutomationRun[]): AutomationRun[] {
  const running: AutomationRun[] = [];
  const rest: AutomationRun[] = [];
  for (const run of runs) {
    if (run.status === "running") {
      running.push(run);
    } else {
      rest.push(run);
    }
  }
  return [...running, ...rest];
}

// ---------------------------------------------------------------------------
// Helper — build fetch options from status filter
// ---------------------------------------------------------------------------

function buildFetchOpts(statusFilter: string, limit: number): { limit: number; status?: string } {
  const opts: { limit: number; status?: string } = { limit };
  if (statusFilter !== "all") {
    opts.status = statusFilter;
  }
  return opts;
}

// ---------------------------------------------------------------------------
// RunsPageContent — main content (extracted to reduce complexity)
// ---------------------------------------------------------------------------

interface RunsPageContentProps {
  projectId: string;
  automationId: string;
}

function RunsPageContent({ projectId, automationId }: RunsPageContentProps) {
  const navigate = useNavigate();

  const runs = useAutomationStore(selectRuns);
  const runLoading = useAutomationStore(selectRunLoading);
  const fetchRuns = useAutomationStore(selectFetchRuns);

  const [automationName, setAutomationName] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // Fetch automation name
  useEffect(() => {
    apiGet<{ name: string }>(`/api/${projectId}/automations/${automationId}`)
      .then((res) => {
        if (res.data) {
          setAutomationName(res.data.name);
        }
      });
  }, [projectId, automationId]);

  // Fetch runs when filter changes
  useEffect(() => {
    const opts = buildFetchOpts(statusFilter, PAGE_SIZE);
    fetchRuns(projectId, automationId, opts).then(() => {
      const currentRuns = useAutomationStore.getState().runs;
      setHasMore(currentRuns.length >= PAGE_SIZE);
    });
  }, [projectId, automationId, statusFilter, fetchRuns]);

  const handleBack = useCallback(() => {
    navigate(`/${projectId}/automations`);
  }, [navigate, projectId]);

  const handleRefresh = useCallback(() => {
    const opts = buildFetchOpts(statusFilter, PAGE_SIZE);
    fetchRuns(projectId, automationId, opts);
  }, [projectId, automationId, statusFilter, fetchRuns]);

  const handleLoadMore = useCallback(async () => {
    setLoadMoreLoading(true);
    const opts = buildFetchOpts(statusFilter, runs.length + PAGE_SIZE);
    await fetchRuns(projectId, automationId, opts);
    const updatedRuns = useAutomationStore.getState().runs;
    setHasMore(updatedRuns.length >= opts.limit);
    setLoadMoreLoading(false);
  }, [projectId, automationId, statusFilter, runs.length, fetchRuns]);

  const sortedRuns = sortRunsWithRunningFirst(runs);
  const headerTitle = automationName ? `${automationName} \u2014 Run History` : "Run History";
  const showLoadMore = hasMore && !runLoading && sortedRuns.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Back to automations"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="space-y-0.5">
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Timer className="h-5 w-5" aria-hidden="true" />
              {headerTitle}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatusFilter value={statusFilter} onChange={setStatusFilter} />
          <button
            onClick={handleRefresh}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
              "bg-accent text-accent-foreground hover:bg-accent/80 transition-colors",
            )}
            aria-label="Refresh runs"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {/* Loading */}
      {runLoading && runs.length === 0 && <RunListSkeleton />}

      {/* Empty state */}
      {!runLoading && sortedRuns.length === 0 && (
        <EmptyState hasFilter={statusFilter !== "all"} />
      )}

      {/* Run cards */}
      {sortedRuns.length > 0 && (
        <div className="space-y-3">
          {sortedRuns.map((run, i) => (
            <RunCard
              key={run.id}
              run={run}
              index={sortedRuns.length - 1 - i}
              projectId={projectId}
              automationId={automationId}
            />
          ))}
        </div>
      )}

      {/* Load more */}
      {showLoadMore && (
        <div className="flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loadMoreLoading}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium",
              "bg-accent text-accent-foreground hover:bg-accent/80 transition-colors",
              loadMoreLoading && "opacity-50 cursor-not-allowed",
            )}
          >
            {loadMoreLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Load More
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AutomationRunsPage() {
  const { projectId, id: automationId } = useParams<{ projectId: string; id: string }>();

  if (!projectId || !automationId) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        Invalid route parameters.
      </div>
    );
  }

  return <RunsPageContent projectId={projectId} automationId={automationId} />;
}
