import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { ArrowLeft, Timer, Loader2, XCircle, GitBranch } from "lucide-react";
import { cn } from "../lib/utils";
import { apiGet } from "../api/client";
import { useAutomationStore, type AutomationStore } from "../stores/automation-store";
import { Skeleton } from "../components/ui/Skeleton";
import { RunStatusBadge } from "../components/automations/RunStatusBadge";
import { ChainTimeline } from "../components/automations/ChainTimeline";
import { StepDetail } from "../components/automations/StepDetail";
import { LiveRunView } from "../components/automations/LiveRunView";

// ---------------------------------------------------------------------------
// Stable selectors
// ---------------------------------------------------------------------------

const selectActiveRun = (s: AutomationStore) => s.activeRun;
const selectRunLoading = (s: AutomationStore) => s.runLoading;
const selectFetchRunDetails = (s: AutomationStore) => s.fetchRunDetails;
const selectCancelRun = (s: AutomationStore) => s.cancelRun;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAbsoluteTime(dateStr: string | undefined): string {
  if (!dateStr) return "-";
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

// ---------------------------------------------------------------------------
// WorktreeInfo section
// ---------------------------------------------------------------------------

interface WorktreeDisplay {
  worktreeId: string;
  path: string;
  branch: string;
  status: "active" | "cleaned_up" | "retained";
}

function WorktreeInfoSection({ worktree }: { worktree: WorktreeDisplay }) {
  const statusLabel: Record<string, string> = {
    active: "Active",
    cleaned_up: "Cleaned Up",
    retained: "Retained",
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <GitBranch className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Worktree
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div>
          <span className="text-muted-foreground">Branch:</span>
          <span className="ml-1 font-medium font-mono">{worktree.branch}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Path:</span>
          <span className="ml-1 font-medium font-mono truncate">{worktree.path}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Status:</span>
          <span className="ml-1 font-medium">{statusLabel[worktree.status] ?? worktree.status}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FinalOutputSection
// ---------------------------------------------------------------------------

function FinalOutputSection({ response }: { response: string | undefined }) {
  if (!response) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <h3 className="text-sm font-semibold">Final Output</h3>
      <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto max-h-60 whitespace-pre-wrap break-words">
        {response}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunHeaderInfo — extracted to keep complexity low
// ---------------------------------------------------------------------------

interface RunHeaderInfoProps {
  runNumber: string;
  automationName: string;
  status: string;
  startedAt: string;
  durationMs: number | undefined;
}

function RunHeaderInfo({ runNumber, automationName, status, startedAt, durationMs }: RunHeaderInfoProps) {
  const headerTitle = automationName
    ? `Run #${runNumber} \u2014 ${automationName}`
    : `Run #${runNumber}`;

  return (
    <div className="space-y-1 min-w-0">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <Timer className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
        <span className="truncate">{headerTitle}</span>
      </h1>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <RunStatusBadge status={status} />
        <span>Started: {formatAbsoluteTime(startedAt)}</span>
        <span>Duration: <span className="font-medium text-foreground tabular-nums">{formatDuration(durationMs)}</span></span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DetailSkeleton
// ---------------------------------------------------------------------------

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <Skeleton className="h-8 w-full" />
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunNotFound
// ---------------------------------------------------------------------------

function RunNotFound({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to runs
      </button>
      <div className="rounded-lg border border-border border-dashed p-12 text-center space-y-3">
        <Timer className="h-10 w-10 mx-auto text-muted-foreground/50" aria-hidden="true" />
        <h3 className="text-base font-medium">Run not found</h3>
        <p className="text-sm text-muted-foreground">
          This run may have been deleted or the ID is invalid.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunDetailContent — main content when run data is available
// ---------------------------------------------------------------------------

interface RunDetailContentProps {
  projectId: string;
  automationId: string;
  runId: string;
  automationName: string;
  onBack: () => void;
  onCancel: () => Promise<void>;
  onRunComplete: () => void;
}

// ---------------------------------------------------------------------------
// CancelRunButton
// ---------------------------------------------------------------------------

function CancelRunButton({ onCancel }: { onCancel: () => Promise<void> }) {
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    try {
      await onCancel();
    } catch {
      // Error shown via toast
    } finally {
      setCancelling(false);
    }
  }, [onCancel]);

  const CancelIcon = cancelling ? Loader2 : XCircle;

  return (
    <button
      onClick={handleCancel}
      disabled={cancelling}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
        "bg-red-600 text-white hover:bg-red-700 transition-colors",
        cancelling && "opacity-50 cursor-not-allowed",
      )}
    >
      <CancelIcon className={cn("h-4 w-4", cancelling && "animate-spin")} aria-hidden="true" />
      Cancel Run
    </button>
  );
}

// ---------------------------------------------------------------------------
// RunErrorSection
// ---------------------------------------------------------------------------

function RunErrorSection({ error }: { error: string }) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-50 dark:bg-red-950/30 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">Run Error</h3>
      <pre className="text-xs font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap break-all">
        {error}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunDetailBody — the sections below the header (timeline, steps, output, error)
// ---------------------------------------------------------------------------

interface RunDetailBodyProps {
  projectId: string;
  automationId: string;
  runId: string;
  onRunComplete: () => void;
}

function RunDetailBody({ projectId, automationId, runId, onRunComplete }: RunDetailBodyProps) {
  const activeRunData = useAutomationStore(selectActiveRun);
  if (!activeRunData) return null;

  const isRunning = activeRunData.status === "running";
  const hasSteps = activeRunData.steps.length > 0;
  const expandSteps = activeRunData.steps.length === 1;
  const lastStep = activeRunData.steps[activeRunData.steps.length - 1];
  const showFinalOutput = !isRunning && lastStep?.response;

  return (
    <>
      {isRunning && (
        <LiveRunView runId={runId} projectId={projectId} automationId={automationId} onRunComplete={onRunComplete} />
      )}
      {hasSteps && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Chain Timeline</h2>
          <ChainTimeline steps={activeRunData.steps} totalDurationMs={activeRunData.durationMs} />
        </div>
      )}
      {activeRunData.worktree && <WorktreeInfoSection worktree={activeRunData.worktree} />}
      {hasSteps && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Steps</h2>
          {activeRunData.steps.map((step, i) => (
            <StepDetail key={step.stepId} step={step} index={i} defaultExpanded={expandSteps} />
          ))}
        </div>
      )}
      {showFinalOutput && <FinalOutputSection response={lastStep.response} />}
      {activeRunData.error && <RunErrorSection error={activeRunData.error} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// RunDetailContent
// ---------------------------------------------------------------------------

function RunDetailContent({
  projectId,
  automationId,
  runId,
  automationName,
  onBack,
  onCancel,
  onRunComplete,
}: RunDetailContentProps) {
  const activeRunData = useAutomationStore(selectActiveRun);

  if (!activeRunData) return null;

  const isRunning = activeRunData.status === "running";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <button
            onClick={onBack}
            className="p-1 mt-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Back to run history"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <RunHeaderInfo
            runNumber={runId.slice(0, 8)}
            automationName={automationName}
            status={activeRunData.status}
            startedAt={activeRunData.startedAt}
            durationMs={activeRunData.durationMs}
          />
        </div>
        {isRunning && <CancelRunButton onCancel={onCancel} />}
      </div>

      <RunDetailBody
        projectId={projectId}
        automationId={automationId}
        runId={runId}
        onRunComplete={onRunComplete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AutomationRunDetailPage() {
  const { projectId, id: automationId, runId } = useParams<{
    projectId: string;
    id: string;
    runId: string;
  }>();
  const navigate = useNavigate();

  const activeRunData = useAutomationStore(selectActiveRun);
  const runLoading = useAutomationStore(selectRunLoading);
  const fetchRunDetails = useAutomationStore(selectFetchRunDetails);
  const cancelRun = useAutomationStore(selectCancelRun);

  const [automationName, setAutomationName] = useState("");

  // Fetch automation name
  useEffect(() => {
    if (!projectId || !automationId) return;
    apiGet<{ name: string }>(`/api/${projectId}/automations/${automationId}`)
      .then((res) => {
        if (res.data) {
          setAutomationName(res.data.name);
        }
      });
  }, [projectId, automationId]);

  // Fetch run details
  useEffect(() => {
    if (!projectId || !automationId || !runId) return;
    fetchRunDetails(projectId, automationId, runId);
  }, [projectId, automationId, runId, fetchRunDetails]);

  const handleBack = useCallback(() => {
    if (!projectId || !automationId) return;
    navigate(`/${projectId}/automations/${automationId}/runs`);
  }, [navigate, projectId, automationId]);

  const handleCancel = useCallback(async () => {
    if (!projectId || !automationId || !runId) return;
    await cancelRun(projectId, automationId, runId);
  }, [cancelRun, projectId, automationId, runId]);

  const handleRunComplete = useCallback(() => {
    if (!projectId || !automationId || !runId) return;
    fetchRunDetails(projectId, automationId, runId);
  }, [fetchRunDetails, projectId, automationId, runId]);

  if (!projectId || !automationId || !runId) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        Invalid route parameters.
      </div>
    );
  }

  if (runLoading && !activeRunData) {
    return <DetailSkeleton />;
  }

  if (!activeRunData) {
    return <RunNotFound onBack={handleBack} />;
  }

  return (
    <RunDetailContent
      projectId={projectId}
      automationId={automationId}
      runId={runId}
      automationName={automationName}
      onBack={handleBack}
      onCancel={handleCancel}
      onRunComplete={handleRunComplete}
    />
  );
}
