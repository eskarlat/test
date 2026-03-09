import { cn } from "../../lib/utils";

// ---------------------------------------------------------------------------
// Run status configuration
// ---------------------------------------------------------------------------

const runStatusConfig: Record<string, { label: string; className: string }> = {
  completed: {
    label: "Completed",
    className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  },
  completed_with_warnings: {
    label: "Warnings",
    className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
  timed_out: {
    label: "Timed Out",
    className: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  },
  running: {
    label: "Running",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 animate-pulse",
  },
  pending: {
    label: "Pending",
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
};

const runFallback = {
  label: "Unknown",
  className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

// ---------------------------------------------------------------------------
// Step status configuration
// ---------------------------------------------------------------------------

const stepStatusConfig: Record<string, { label: string; className: string }> = {
  completed: {
    label: "Completed",
    className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  },
  skipped: {
    label: "Skipped",
    className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  },
  running: {
    label: "Running",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 animate-pulse",
  },
  pending: {
    label: "Pending",
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
};

const stepFallback = {
  label: "Unknown",
  className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RunStatusBadgeProps {
  status: string;
  variant?: "run" | "step";
}

export function RunStatusBadge({ status, variant = "run" }: RunStatusBadgeProps) {
  const configMap = variant === "step" ? stepStatusConfig : runStatusConfig;
  const fallback = variant === "step" ? stepFallback : runFallback;
  const config = configMap[status] ?? fallback;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}
