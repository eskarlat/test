import { useEffect } from "react";
import { X, ArrowUp, Loader2 } from "lucide-react";

interface UpgradeDialogProps {
  extensionName: string;
  currentVersion: string;
  targetVersion: string;
  upgrading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmation dialog before upgrading an extension.
 * Keyboard: Enter = confirm, Escape = close.
 */
export function UpgradeDialog({
  extensionName,
  currentVersion,
  targetVersion,
  upgrading,
  onConfirm,
  onClose,
}: UpgradeDialogProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !upgrading) onClose();
      if (e.key === "Enter" && !upgrading) onConfirm();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, onConfirm, upgrading]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !upgrading) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-background shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ArrowUp className="h-5 w-5 text-primary flex-shrink-0" aria-hidden="true" />
            <h2 id="upgrade-dialog-title" className="text-base font-semibold text-foreground">
              Upgrade {extensionName}?
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={upgrading}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <p className="text-sm text-muted-foreground">
            Upgrade <strong className="text-foreground">{extensionName}</strong> from{" "}
            <code className="font-mono bg-muted px-1 rounded text-xs">v{currentVersion}</code> to{" "}
            <code className="font-mono bg-muted px-1 rounded text-xs">v{targetVersion}</code>?
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            The extension will be remounted with the new version. This may take a few seconds if
            the extension uses MCP.
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border bg-muted/30">
          <button
            type="button"
            onClick={onClose}
            disabled={upgrading}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={upgrading}
            className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {upgrading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Upgrading...
              </>
            ) : (
              <>
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                Upgrade
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
