import { useState, useEffect, useCallback } from "react";
import { KeyRound, Trash2, Loader2 } from "lucide-react";

interface VaultKeyListProps {
  loading: boolean;
  keys: string[];
  deletingKey: string | null;
  onDelete: (key: string) => void;
}

export function VaultKeyList({ loading, keys, deletingKey, onDelete }: VaultKeyListProps) {
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  // Auto-dismiss confirmation after 3 seconds
  useEffect(() => {
    if (!confirmKey) return;
    const timer = setTimeout(() => setConfirmKey(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmKey]);

  const handleClick = useCallback(
    (key: string) => {
      if (confirmKey === key) {
        setConfirmKey(null);
        onDelete(key);
      } else {
        setConfirmKey(key);
      }
    },
    [confirmKey, onDelete],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading vault keys...
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <KeyRound className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">No secrets stored</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add a secret below to use with extension settings.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card divide-y divide-border">
      {keys.map((key) => {
        const isConfirming = confirmKey === key;
        const isDeleting = deletingKey === key;

        return (
          <div key={key} className="flex items-center gap-3 px-4 py-3">
            <KeyRound className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
            <span className="flex-1 text-sm font-mono text-foreground">{key}</span>
            <span className="text-xs text-muted-foreground font-mono select-none">••••••••</span>
            {isConfirming && !isDeleting && (
              <button
                onClick={() => setConfirmKey(null)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={() => handleClick(key)}
              disabled={isDeleting}
              className={`flex items-center gap-1 text-xs transition-colors disabled:opacity-50 ${
                isConfirming
                  ? "text-destructive font-medium"
                  : "text-muted-foreground hover:text-destructive"
              }`}
              aria-label={isConfirming ? `Confirm delete ${key}` : `Delete secret ${key}`}
            >
              {isDeleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {isConfirming && "Delete?"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
