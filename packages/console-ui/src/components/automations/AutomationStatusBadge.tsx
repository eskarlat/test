import { cn } from "../../lib/utils";

interface AutomationStatusBadgeProps {
  status: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  running: {
    label: "RUNNING",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 animate-pulse",
  },
  completed: {
    label: "COMPLETED",
    className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  },
  completed_with_warnings: {
    label: "WARNINGS",
    className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  },
  failed: {
    label: "FAILED",
    className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  },
  cancelled: {
    label: "CANCELLED",
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
  timed_out: {
    label: "TIMED OUT",
    className: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  },
  pending: {
    label: "PENDING",
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
};

const fallbackConfig = {
  label: "UNKNOWN",
  className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

export function AutomationStatusBadge({ status }: AutomationStatusBadgeProps) {
  const config = statusConfig[status] ?? fallbackConfig;

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
