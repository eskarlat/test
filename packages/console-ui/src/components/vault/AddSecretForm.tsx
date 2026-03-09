import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

interface AddSecretFormProps {
  saving: boolean;
  error: string | null;
  onSave: (key: string, value: string) => Promise<void>;
  onCancel: () => void;
}

export function AddSecretForm({ saving, error, onSave, onCancel }: AddSecretFormProps) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [showValue, setShowValue] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newKey.trim() || !newValue.trim()) return;
    await onSave(newKey.trim(), newValue);
    setNewKey("");
    setNewValue("");
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-lg border border-border bg-card p-4 space-y-3"
    >
      <h2 className="text-sm font-semibold text-foreground">New Secret</h2>

      <div className="space-y-1">
        <label htmlFor="vault-add-key" className="block text-xs font-medium text-foreground">
          Key name
        </label>
        <input
          id="vault-add-key"
          type="text"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="MY_API_KEY"
          autoComplete="off"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="vault-add-value" className="block text-xs font-medium text-foreground">
          Value
        </label>
        <div className="relative">
          <input
            id="vault-add-value"
            type={showValue ? "text" : "password"}
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Secret value"
            autoComplete="new-password"
            className="w-full rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={() => setShowValue((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={showValue ? "Hide value" : "Show value"}
          >
            {showValue ? (
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !newKey.trim() || !newValue.trim()}
          className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
