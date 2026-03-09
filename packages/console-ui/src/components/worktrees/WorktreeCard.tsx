import { GitBranch, Clock, Loader2, FolderOpen } from "lucide-react";
import { cn } from "../../lib/utils";
import { formatBytes } from "./DiskUsageBar";
import { WorktreeStatusBadge } from "./WorktreeStatusBadge";
import { WorktreeActions } from "./WorktreeActions";
import type { Worktree } from "../../types/worktree";

interface WorktreeCardProps {
  worktree: Worktree;
  projectId: string;
}

function formatCreator(worktree: Worktree): string {
  switch (worktree.createdBy.type) {
    case "automation":
      const suffix = worktree.createdBy.automationId ? " (" + worktree.createdBy.automationId + ")" : "";
      return "Automation" + suffix;
    case "chat":
      return "Chat session";
    case "user":
      return "Manual";
    default:
      return "Unknown";
  }
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

const isTransitional = (status: Worktree["status"]) =>
  status === "creating" || status === "removing";

export function WorktreeCard({ worktree, projectId }: WorktreeCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4 space-y-3 transition-shadow",
        worktree.status === "error" && "border-red-500/30",
        worktree.status === "in_use" && "border-green-500/30",
      )}
    >
      {/* Header: branch + status badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium truncate">{worktree.branch}</span>
          {worktree.baseBranch && (
            <span className="text-xs text-muted-foreground truncate">
              from {worktree.baseBranch}
            </span>
          )}
        </div>
        <WorktreeStatusBadge status={worktree.status} />
      </div>

      {/* Metadata row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden="true" />
          Created {formatRelativeTime(worktree.createdAt)}
        </span>
        <span>Creator: {formatCreator(worktree)}</span>
        {worktree.diskUsageBytes != null && worktree.diskUsageBytes > 0 && (
          <span>{formatBytes(worktree.diskUsageBytes)}</span>
        )}
        <span className="capitalize">cleanup: {worktree.cleanupPolicy}</span>
        {worktree.expiresAt && (
          <span>expires {formatRelativeTime(worktree.expiresAt)}</span>
        )}
      </div>

      {/* Path */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FolderOpen className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
        <code className="truncate font-mono">{worktree.path}</code>
      </div>

      {/* Transitional spinner */}
      {isTransitional(worktree.status) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          <span>{worktree.status === "creating" ? "Creating worktree..." : "Removing worktree..."}</span>
        </div>
      )}

      {/* Actions */}
      {!isTransitional(worktree.status) && (
        <WorktreeActions worktree={worktree} projectId={projectId} />
      )}
    </div>
  );
}
