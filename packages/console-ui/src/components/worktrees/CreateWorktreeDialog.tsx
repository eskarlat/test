import { useState, useCallback, useEffect, useRef } from "react";
import { X, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { useWorktreeStore } from "../../stores/worktree-store";
import type { CleanupPolicy } from "../../types/worktree";

interface CreateWorktreeDialogProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

type BranchMode = "existing" | "new";

const cleanupOptions: Array<{ value: CleanupPolicy; label: string; description: string }> = [
  { value: "always", label: "Always", description: "Remove after use regardless of outcome" },
  { value: "on_success", label: "On Success", description: "Remove only if the work completes successfully" },
  { value: "never", label: "Never", description: "Keep worktree until manually removed" },
  { value: "ttl", label: "TTL", description: "Remove after a time-to-live expires" },
];

export function CreateWorktreeDialog({ projectId, open, onClose }: CreateWorktreeDialogProps) {
  const createWorktree = useWorktreeStore((s) => s.createWorktree);

  const [branchMode, setBranchMode] = useState<BranchMode>("new");
  const [branchName, setBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [cleanupPolicy, setCleanupPolicy] = useState<CleanupPolicy>("always");
  const [ttlMinutes, setTtlMinutes] = useState("60");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap: focus the dialog when it opens
  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const resetForm = useCallback(() => {
    setBranchMode("new");
    setBranchName("");
    setBaseBranch("");
    setCleanupPolicy("always");
    setTtlMinutes("60");
    setFormError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!branchName.trim()) {
      setFormError("Branch name is required");
      return;
    }

    if (cleanupPolicy === "ttl") {
      const mins = parseInt(ttlMinutes, 10);
      if (isNaN(mins) || mins <= 0) {
        setFormError("TTL must be a positive number of minutes");
        return;
      }
    }

    setCreating(true);
    try {
      await createWorktree(projectId, {
        branch: branchName.trim(),
        createBranch: branchMode === "new",
        ...(branchMode === "new" && baseBranch.trim() ? { baseBranch: baseBranch.trim() } : {}),
        cleanupPolicy,
        createdBy: { type: "user" },
        ...(cleanupPolicy === "ttl" ? { ttlMs: parseInt(ttlMinutes, 10) * 60_000 } : {}),
      });
      handleClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create worktree");
    } finally {
      setCreating(false);
    }
  }, [branchName, branchMode, baseBranch, cleanupPolicy, ttlMinutes, createWorktree, projectId, handleClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Create worktree"
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">New Worktree</h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Branch mode radio */}
          <fieldset>
            <legend className="text-sm font-medium mb-2">Branch</legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="branchMode"
                  value="new"
                  checked={branchMode === "new"}
                  onChange={() => setBranchMode("new")}
                  className="accent-primary"
                />
                Create new branch
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="branchMode"
                  value="existing"
                  checked={branchMode === "existing"}
                  onChange={() => setBranchMode("existing")}
                  className="accent-primary"
                />
                Use existing branch
              </label>
            </div>
          </fieldset>

          {/* Branch name */}
          <div>
            <label htmlFor="wt-branch" className="block text-sm font-medium mb-1">
              Branch name
            </label>
            <input
              id="wt-branch"
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder={branchMode === "new" ? "feature/my-change" : "existing-branch-name"}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoFocus
            />
          </div>

          {/* Base branch (only for new branches) */}
          {branchMode === "new" && (
            <div>
              <label htmlFor="wt-base" className="block text-sm font-medium mb-1">
                Base branch <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                id="wt-base"
                type="text"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                placeholder="main"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          )}

          {/* Cleanup policy */}
          <fieldset>
            <legend className="text-sm font-medium mb-2">Cleanup Policy</legend>
            <div className="space-y-2">
              {cleanupOptions.map((opt) => (
                <label key={opt.value} className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="cleanupPolicy"
                    value={opt.value}
                    checked={cleanupPolicy === opt.value}
                    onChange={() => setCleanupPolicy(opt.value)}
                    className="accent-primary mt-0.5"
                  />
                  <div>
                    <span className="font-medium">{opt.label}</span>
                    <span className="text-muted-foreground ml-1.5">- {opt.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

          {/* TTL input */}
          {cleanupPolicy === "ttl" && (
            <div>
              <label htmlFor="wt-ttl" className="block text-sm font-medium mb-1">
                TTL (minutes)
              </label>
              <input
                id="wt-ttl"
                type="number"
                min="1"
                value={ttlMinutes}
                onChange={(e) => setTtlMinutes(e.target.value)}
                className="w-32 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          )}

          {/* Error */}
          {formError && (
            <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
          )}

          {/* Buttons */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
                "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
                creating && "opacity-50 cursor-not-allowed",
              )}
            >
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
