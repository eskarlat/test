import { cn } from "../../lib/utils";
import type { StepExecution } from "../../types/automation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBarColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-green-500 dark:bg-green-600";
    case "failed":
      return "bg-red-500 dark:bg-red-600";
    case "skipped":
      return "bg-yellow-500 dark:bg-yellow-600";
    case "running":
      return "bg-blue-500 dark:bg-blue-600 animate-pulse";
    case "pending":
    default:
      return "bg-gray-300 dark:bg-gray-600";
  }
}

function formatSegmentDuration(ms: number | undefined): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ChainTimelineProps {
  steps: StepExecution[];
  totalDurationMs?: number | undefined;
}

export function ChainTimeline({ steps, totalDurationMs }: ChainTimelineProps) {
  if (steps.length === 0) return null;

  // Calculate proportional widths based on duration, or equal if no durations
  const hasDurations = steps.some((s) => s.durationMs != null && s.durationMs > 0);
  const total = hasDurations
    ? (totalDurationMs ?? steps.reduce((acc, s) => acc + (s.durationMs ?? 0), 0))
    : steps.length;

  return (
    <div className="space-y-1">
      {/* Timeline bar */}
      <div className="flex h-6 rounded-md overflow-hidden border border-border">
        {steps.map((step) => {
          const width = hasDurations
            ? ((step.durationMs ?? 0) / Math.max(total, 1)) * 100
            : (1 / steps.length) * 100;
          // Ensure a minimum width so tiny segments remain visible
          const minWidth = Math.max(width, 100 / steps.length * 0.3);

          return (
            <div
              key={step.stepId}
              className={cn("relative group transition-all", statusBarColor(step.status))}
              style={{ width: `${minWidth}%`, minWidth: "12px" }}
              title={`${step.stepName}: ${step.status} (${formatSegmentDuration(step.durationMs)})`}
            >
              {/* Hover tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
                <div className="bg-popover border border-border rounded px-2 py-1 text-[10px] whitespace-nowrap shadow-md">
                  <span className="font-medium">{step.stepName}</span>
                  <span className="text-muted-foreground ml-1">
                    {formatSegmentDuration(step.durationMs)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step labels below the bar */}
      <div className="flex text-[10px] text-muted-foreground">
        {steps.map((step) => {
          const width = hasDurations
            ? ((step.durationMs ?? 0) / Math.max(total, 1)) * 100
            : (1 / steps.length) * 100;
          const minWidth = Math.max(width, 100 / steps.length * 0.3);

          return (
            <div
              key={step.stepId}
              className="truncate px-0.5 text-center"
              style={{ width: `${minWidth}%`, minWidth: "12px" }}
            >
              <span className="block truncate">{step.stepName}</span>
              <span className="block tabular-nums">{formatSegmentDuration(step.durationMs)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
