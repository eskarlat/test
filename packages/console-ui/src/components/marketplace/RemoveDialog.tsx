import { useEffect } from "react";
import { X, AlertTriangle, Loader2, Trash2 } from "lucide-react";

interface RemoveDialogProps {
  extensionName: string;
  removing: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmation dialog before removing an extension.
 * Keyboard: Enter = confirm, Escape = close.
 */
export function RemoveDialog({
  extensionName,
  removing,
  onConfirm,
  onClose,
}: RemoveDialogProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !removing) onClose();
      if (e.key === "Enter" && !removing) onConfirm();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, onConfirm, removing]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !removing) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-background shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" aria-hidden="true" />
            <h2 id="remove-dialog-title" className="text-base font-semibold text-foreground">
              Remove {extensionName}?
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={removing}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <p className="text-sm text-muted-foreground">
            This will unmount <strong className="text-foreground">{extensionName}</strong>, remove
            its hooks and skills from the project, and update{" "}
            <code className="font-mono bg-muted px-1 rounded text-xs">.renre-kit/extensions.json</code>.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            The extension&apos;s data tables (if any) are preserved. This action cannot be undone.
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border bg-muted/30">
          <button
            type="button"
            onClick={onClose}
            disabled={removing}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={removing}
            className="flex items-center gap-1.5 rounded-md bg-destructive text-destructive-foreground px-3 py-1.5 text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {removing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Removing...
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Remove
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
