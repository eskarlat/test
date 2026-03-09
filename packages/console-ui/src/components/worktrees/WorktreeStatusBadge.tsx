import { cn } from "../../lib/utils";
import type { WorktreeStatus } from "../../types/worktree";

interface WorktreeStatusBadgeProps {
  status: WorktreeStatus;
}

const statusConfig: Record<WorktreeStatus, { label: string; className: string }> = {
  creating: {
    label: "CREATING",
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
  ready: {
    label: "READY",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  },
  in_use: {
    label: "IN USE",
    className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 animate-pulse",
  },
  completed: {
    label: "COMPLETED",
    className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  },
  error: {
    label: "ERROR",
    className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  },
  removing: {
    label: "REMOVING",
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
};

export function WorktreeStatusBadge({ status }: WorktreeStatusBadgeProps) {
  const config = statusConfig[status];

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
