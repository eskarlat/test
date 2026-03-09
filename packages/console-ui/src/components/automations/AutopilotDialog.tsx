import { useEffect, useRef } from "react";
import { ShieldAlert } from "lucide-react";
import { cn } from "../../lib/utils";

interface AutopilotDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AutopilotDialog({ open, onConfirm, onCancel }: AutopilotDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the dialog when it opens
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
        onCancel();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Enable autopilot mode"
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <ShieldAlert className="h-5 w-5 text-amber-500 flex-shrink-0" aria-hidden="true" />
          <h2 className="text-base font-semibold">Enable Autopilot Mode</h2>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3 text-sm text-muted-foreground">
          <p>This automation will run in autopilot mode.</p>
          <p>
            All tool permission requests (file writes, shell commands, API calls)
            will be automatically approved without human review.
          </p>
          <p>You can review all actions in the run logs afterward.</p>
          <p className="text-xs border-l-2 border-amber-500/50 pl-3">
            Tool governance rules still apply — denied tools will be blocked
            regardless of autopilot mode.
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
              "bg-amber-600 text-white hover:bg-amber-700 transition-colors",
            )}
          >
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            Enable Autopilot
          </button>
        </div>
      </div>
    </div>
  );
}
