import { useState, useCallback } from "react";
import { Copy, Trash2, ExternalLink, Loader2, FileDiff, GitMerge, GitPullRequest } from "lucide-react";
import { cn } from "../../lib/utils";
import { apiGet, apiPost } from "../../api/client";
import { useWorktreeStore } from "../../stores/worktree-store";
import type { Worktree } from "../../types/worktree";

const btnBase = cn(
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
  "bg-accent text-accent-foreground hover:bg-accent/80 transition-colors",
);

const btnDanger = cn(
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
  "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800 transition-colors",
);

// ---------------------------------------------------------------------------
// Merge Dialog
// ---------------------------------------------------------------------------

function MergeSection({ worktree, projectId }: { worktree: Worktree; projectId: string }) {
  const [open, setOpen] = useState(false);
  const [targetBranch, setTargetBranch] = useState(worktree.baseBranch ?? "main");
  const [merging, setMerging] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleMerge = useCallback(async () => {
    setMerging(true);
    setError(null);
    setResult(null);
    const res = await apiPost<{ message: string }>(`/api/${projectId}/worktrees/${worktree.id}/merge`, {
      targetBranch,
    });
    if (res.data) {
      setResult(res.data.message ?? "Merge completed successfully");
    } else {
      const msg = res.error ?? "Merge failed";
      if (msg.includes("conflict")) {
        setError(`Merge conflict detected — resolve manually in terminal. Path: ${worktree.path}`);
      } else {
        setError(msg);
      }
    }
    setMerging(false);
  }, [projectId, worktree.id, worktree.path, targetBranch]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={btnBase}>
        <GitMerge className="h-3 w-3" aria-hidden="true" />
        Merge
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border p-2 text-xs">
      <span className="font-medium">Merge {worktree.branch} into:</span>
      <input
        type="text"
        value={targetBranch}
        onChange={(e) => setTargetBranch(e.target.value)}
        className="rounded border border-input bg-background px-2 py-1 text-xs"
        placeholder="target branch"
      />
      <div className="flex gap-1.5">
        <button onClick={handleMerge} disabled={merging || !targetBranch} className={cn(btnBase, (merging || !targetBranch) && "opacity-50 cursor-not-allowed")}>
          {merging && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          Confirm Merge
        </button>
        <button onClick={() => { setOpen(false); setError(null); setResult(null); }} className={btnBase}>
          Cancel
        </button>
      </div>
      {result && <span className="text-green-600 dark:text-green-400">{result}</span>}
      {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create PR
// ---------------------------------------------------------------------------

function CreatePRSection({ worktree, projectId }: { worktree: Worktree; projectId: string }) {
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreatePR = useCallback(async () => {
    setError(null);
    setPushing(true);
    // Ask backend to push and get PR URL
    const res = await apiPost<{ url?: string; error?: string; pushed?: boolean }>(
      `/api/${projectId}/worktrees/${worktree.id}/create-pr`,
      { baseBranch: worktree.baseBranch ?? "main" },
    );
    setPushing(false);
    if (res.data?.url) {
      window.open(res.data.url, "_blank", "noopener");
    } else if (res.data?.error) {
      setError(res.data.error);
    } else {
      setError(res.error ?? "Not available — project may not be hosted on GitHub");
    }
  }, [projectId, worktree.id, worktree.baseBranch]);

  return (
    <>
      <button onClick={handleCreatePR} disabled={pushing} className={cn(btnBase, pushing && "opacity-50 cursor-not-allowed")}>
        {pushing ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : (
          <GitPullRequest className="h-3 w-3" aria-hidden="true" />
        )}
        Create PR
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Actions
// ---------------------------------------------------------------------------

interface WorktreeActionsProps {
  worktree: Worktree;
  projectId: string;
}

export function WorktreeActions({ worktree, projectId }: WorktreeActionsProps) {
  const removeWorktree = useWorktreeStore((s) => s.removeWorktree);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(worktree.path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [worktree.path]);

  const handleRemove = useCallback(async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setRemoving(true);
    try {
      await removeWorktree(projectId, worktree.id);
    } catch {
      // Error handled by store
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
    }
  }, [confirmRemove, removeWorktree, projectId, worktree.id]);

  const handleViewChanges = useCallback(async () => {
    if (showDiff) {
      setShowDiff(false);
      return;
    }
    setDiffLoading(true);
    const res = await apiGet<{ diff: string }>(`/api/${projectId}/worktrees/${worktree.id}/diff`);
    if (res.data) {
      setDiffContent(res.data.diff);
    } else {
      setDiffContent("Failed to load diff");
    }
    setShowDiff(true);
    setDiffLoading(false);
  }, [showDiff, projectId, worktree.id]);

  const showRemove = worktree.status === "ready" || worktree.status === "completed" || worktree.status === "error";
  const showCopyPath = worktree.status === "ready" || worktree.status === "completed";
  const showViewChanges = worktree.status === "completed";
  const showMerge = worktree.status === "completed";
  const showCreatePR = worktree.status === "completed";
  const showViewRun = worktree.status === "in_use" && worktree.createdBy.automationRunId;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        {showViewRun && (
          <a
            href={`/${projectId}/automations/${worktree.createdBy.automationRunId}`}
            className={btnBase}
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            View Run
          </a>
        )}

        {showCopyPath && (
          <button onClick={handleCopyPath} className={btnBase}>
            <Copy className="h-3 w-3" aria-hidden="true" />
            {copied ? "Copied!" : "Open Terminal"}
          </button>
        )}

        {showViewChanges && (
          <button
            onClick={handleViewChanges}
            disabled={diffLoading}
            className={cn(btnBase, diffLoading && "opacity-50 cursor-not-allowed")}
          >
            {diffLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : (
              <FileDiff className="h-3 w-3" aria-hidden="true" />
            )}
            {showDiff ? "Hide Changes" : "View Changes"}
          </button>
        )}

        {showMerge && <MergeSection worktree={worktree} projectId={projectId} />}
        {showCreatePR && <CreatePRSection worktree={worktree} projectId={projectId} />}

        {showRemove && !confirmRemove && (
          <button
            onClick={handleRemove}
            disabled={removing}
            className={cn(btnDanger, removing && "opacity-50 cursor-not-allowed")}
          >
            {removing ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            )}
            Remove
          </button>
        )}

        {confirmRemove && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Are you sure? This will remove the worktree.</span>
            <button
              onClick={handleRemove}
              disabled={removing}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
                "bg-red-600 text-white hover:bg-red-700 transition-colors",
                removing && "opacity-50 cursor-not-allowed",
              )}
            >
              {removing && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
              Confirm
            </button>
            <button
              onClick={() => setConfirmRemove(false)}
              className={btnBase}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {showDiff && diffContent !== null && (
        <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap">
          {diffContent || "(no changes)"}
        </pre>
      )}
    </div>
  );
}
