import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router";
import { GitBranch, Plus, Trash2, Loader2, RefreshCw } from "lucide-react";
import { cn } from "../lib/utils";
import { useWorktreeStore, type WorktreeStore } from "../stores/worktree-store";
import { useSocketStore } from "../api/socket";
import { useNotificationStore } from "../stores/notification-store";
import { Skeleton } from "../components/ui/Skeleton";
import { WorktreeCard } from "../components/worktrees/WorktreeCard";
import { DiskUsageBar } from "../components/worktrees/DiskUsageBar";
import { CreateWorktreeDialog } from "../components/worktrees/CreateWorktreeDialog";

// Stable selectors — avoid inline arrow fns that create new refs every render
const selectWorktrees = (s: WorktreeStore) => s.worktrees;
const selectTotalDiskUsage = (s: WorktreeStore) => s.totalDiskUsage;
const selectWorktreeCount = (s: WorktreeStore) => s.worktreeCount;
const selectLoading = (s: WorktreeStore) => s.loading;
const selectError = (s: WorktreeStore) => s.error;
const selectFetchWorktrees = (s: WorktreeStore) => s.fetchWorktrees;
const selectFetchDiskUsage = (s: WorktreeStore) => s.fetchDiskUsage;
const selectTriggerCleanup = (s: WorktreeStore) => s.triggerCleanup;
const selectOnCreated = (s: WorktreeStore) => s.onWorktreeCreated;
const selectOnStatusChanged = (s: WorktreeStore) => s.onWorktreeStatusChanged;
const selectOnRemoved = (s: WorktreeStore) => s.onWorktreeRemoved;
const selectOnError = (s: WorktreeStore) => s.onWorktreeError;
const selectOnCleanup = (s: WorktreeStore) => s.onWorktreeCleanup;

export default function WorktreesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const worktrees = useWorktreeStore(selectWorktrees);
  const totalDiskUsage = useWorktreeStore(selectTotalDiskUsage);
  const worktreeCount = useWorktreeStore(selectWorktreeCount);
  const loading = useWorktreeStore(selectLoading);
  const error = useWorktreeStore(selectError);
  const fetchWorktrees = useWorktreeStore(selectFetchWorktrees);
  const fetchDiskUsage = useWorktreeStore(selectFetchDiskUsage);
  const triggerCleanup = useWorktreeStore(selectTriggerCleanup);
  const onCreated = useWorktreeStore(selectOnCreated);
  const onStatusChanged = useWorktreeStore(selectOnStatusChanged);
  const onRemoved = useWorktreeStore(selectOnRemoved);
  const onError = useWorktreeStore(selectOnError);
  const onCleanup = useWorktreeStore(selectOnCleanup);

  const socket = useSocketStore((s) => s.socket);
  const addToast = useNotificationStore((s) => s.addToast);

  const [createOpen, setCreateOpen] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);

  // Fetch data on mount
  useEffect(() => {
    if (!projectId) return;
    fetchWorktrees(projectId);
    fetchDiskUsage(projectId);
  }, [projectId, fetchWorktrees, fetchDiskUsage]);

  // Subscribe to Socket.IO worktree events
  useEffect(() => {
    if (!socket) return;

    socket.on("worktree:created", onCreated);
    socket.on("worktree:status-changed", onStatusChanged);
    socket.on("worktree:removed", onRemoved);
    socket.on("worktree:error", onError);
    socket.on("worktree:cleanup", onCleanup);

    return () => {
      socket.off("worktree:created", onCreated);
      socket.off("worktree:status-changed", onStatusChanged);
      socket.off("worktree:removed", onRemoved);
      socket.off("worktree:error", onError);
      socket.off("worktree:cleanup", onCleanup);
    };
  }, [socket, onCreated, onStatusChanged, onRemoved, onError, onCleanup]);

  const handleCleanup = useCallback(async () => {
    if (!projectId) return;
    setCleaningUp(true);
    try {
      const result = await triggerCleanup(projectId);
      addToast(
        `Cleaned up ${result.removed} worktree${result.removed !== 1 ? "s" : ""}`,
        "success",
      );
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Cleanup failed",
        "error",
      );
    } finally {
      setCleaningUp(false);
    }
  }, [projectId, triggerCleanup, addToast]);

  const handleRetry = useCallback(() => {
    if (!projectId) return;
    fetchWorktrees(projectId);
    fetchDiskUsage(projectId);
  }, [projectId, fetchWorktrees, fetchDiskUsage]);

  if (!projectId) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        Select a project to view worktrees.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <GitBranch className="h-5 w-5" aria-hidden="true" />
            Worktrees
          </h1>
          {!loading && (
            <DiskUsageBar totalBytes={totalDiskUsage} worktreeCount={worktreeCount} />
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreateOpen(true)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
              "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
            )}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Worktree
          </button>
          <button
            onClick={handleCleanup}
            disabled={cleaningUp}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium",
              "text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
              cleaningUp && "opacity-50 cursor-not-allowed",
            )}
          >
            {cleaningUp ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            )}
            Cleanup
          </button>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="rounded-lg border border-red-500/30 bg-red-50 dark:bg-red-950/30 p-6 text-center space-y-3">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={handleRetry}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
              "bg-accent text-accent-foreground hover:bg-accent/80 transition-colors",
            )}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && worktrees.length === 0 && (
        <div className="rounded-lg border border-border border-dashed p-12 text-center space-y-3">
          <GitBranch className="h-10 w-10 mx-auto text-muted-foreground/50" aria-hidden="true" />
          <h2 className="text-base font-medium">No worktrees</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Worktrees provide isolated git working directories for automations, chat sessions,
            and parallel development. Create one to get started.
          </p>
          <button
            onClick={() => setCreateOpen(true)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
              "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors mt-2",
            )}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create Worktree
          </button>
        </div>
      )}

      {/* Worktree list */}
      {!loading && !error && worktrees.length > 0 && (
        <div className="space-y-3">
          {worktrees.map((wt) => (
            <WorktreeCard key={wt.id} worktree={wt} projectId={projectId} />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <CreateWorktreeDialog
        projectId={projectId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
