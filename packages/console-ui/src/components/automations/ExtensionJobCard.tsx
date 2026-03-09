import { useState, useCallback } from "react";
import { Clock, FileText } from "lucide-react";
import { cn } from "../../lib/utils";
import { useAutomationStore } from "../../stores/automation-store";
import { useNotificationStore } from "../../stores/notification-store";
import type { ExtensionCronJob } from "../../types/automation";
import { ExtensionJobLogsModal } from "./ExtensionJobLogsModal";

interface ExtensionJobCardProps {
  job: ExtensionCronJob;
  projectId: string;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

function statusColor(status: string | null): string {
  switch (status) {
    case "completed":
      return "text-green-600 dark:text-green-400";
    case "running":
      return "text-blue-600 dark:text-blue-400";
    case "failed":
    case "timed_out":
      return "text-red-600 dark:text-red-400";
    default:
      return "text-muted-foreground";
  }
}

function statusDotColor(status: string | null): string {
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

export function ExtensionJobCard({ job, projectId }: ExtensionJobCardProps) {
  const toggleExtensionJob = useAutomationStore((s) => s.toggleExtensionJob);
  const addToast = useNotificationStore((s) => s.addToast);

  const [toggling, setToggling] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  const handleToggle = useCallback(async () => {
    setToggling(true);
    try {
      await toggleExtensionJob(projectId, job.id, !job.enabled);
      addToast(
        job.enabled ? "Job paused" : "Job resumed",
        "info",
      );
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Failed to toggle job",
        "error",
      );
    } finally {
      setToggling(false);
    }
  }, [toggleExtensionJob, projectId, job.id, job.enabled, addToast]);

  return (
    <>
      <div
        className={cn(
          "rounded-lg border border-border bg-card p-4 space-y-3 transition-shadow",
          !job.enabled && "opacity-75",
        )}
      >
        {/* Header: extension:name + toggle */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold truncate">
            {job.extensionName}: {job.name}
          </h3>

          {/* Toggle switch */}
          <button
            type="button"
            role="switch"
            aria-checked={job.enabled}
            aria-label={job.enabled ? "Pause job" : "Resume job"}
            disabled={toggling}
            onClick={handleToggle}
            className={cn(
              "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors",
              job.enabled ? "bg-green-500" : "bg-muted-foreground/30",
              toggling && "opacity-50 cursor-not-allowed",
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5",
                job.enabled ? "translate-x-4.5 ml-0.5" : "translate-x-0.5",
              )}
            />
          </button>
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {job.cron}
          </span>
          {job.lastRunAt ? (
            <span className="flex items-center gap-1.5">
              <span className={cn("inline-block h-1.5 w-1.5 rounded-full", statusDotColor(job.lastRunStatus))} />
              <span className={statusColor(job.lastRunStatus)}>
                {job.lastRunStatus ?? "unknown"}
              </span>
              <span>{formatRelativeTime(job.lastRunAt)}</span>
            </span>
          ) : (
            <span>Never run</span>
          )}
        </div>

        {/* Description */}
        {job.description && (
          <p className="text-xs text-muted-foreground">{job.description}</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setLogsOpen(true)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
              "bg-accent text-accent-foreground hover:bg-accent/80 transition-colors",
            )}
          >
            <FileText className="h-3 w-3" aria-hidden="true" />
            Logs
          </button>
        </div>
      </div>

      <ExtensionJobLogsModal
        open={logsOpen}
        onClose={() => setLogsOpen(false)}
        jobId={job.id}
        jobName={`${job.extensionName}: ${job.name}`}
        projectId={projectId}
      />
    </>
  );
}
