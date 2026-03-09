import { useState } from "react";
import { KeyRound, ChevronDown, Plus, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { apiPost } from "../../api/client";
import { useVaultStore } from "../../stores/vault-store";
import { useNotificationStore } from "../../stores/notification-store";

interface VaultKeyPickerProps {
  /** The currently selected vault key (the plain key name, not the ${VAULT:key} template) */
  value: string;
  /** Called with the plain key name when selection changes */
  onChange: (key: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Dropdown of existing vault keys with inline "Create new secret" section.
 * Returns the plain vault key name (e.g. "jira_token") to the caller.
 * The caller is responsible for rendering it as ${VAULT:key} in the settings payload.
 */
export function VaultKeyPicker({
  value,
  onChange,
  id,
  disabled = false,
  placeholder = "Select vault key...",
}: VaultKeyPickerProps) {
  const keys = useVaultStore((s) => s.keys);
  const fetchKeys = useVaultStore((s) => s.fetchKeys);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate() {
    const trimmedKey = newKey.trim();
    if (!trimmedKey || !newValue) return;

    setCreating(true);
    setCreateError(null);

    const result = await apiPost<{ ok: boolean; key: string }>("/api/vault/secrets", {
      key: trimmedKey,
      value: newValue,
    });

    if (result.error) {
      setCreateError(result.error);
    } else {
      useNotificationStore
        .getState()
        .addToast(`Vault key "${trimmedKey}" created`, "success");
      // Refresh vault store
      await fetchKeys();
      // Auto-select the newly created key
      onChange(trimmedKey);
      // Reset form
      setNewKey("");
      setNewValue("");
      setShowCreate(false);
    }

    setCreating(false);
  }

  return (
    <div className="space-y-2">
      {/* Key selector */}
      <div className="relative">
        <KeyRound
          className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
          aria-hidden="true"
        />
        <select
          id={id}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v !== "__create__") onChange(v);
          }}
          disabled={disabled}
          className={cn(
            "w-full rounded-md border border-input bg-background pl-8 pr-8 py-2 text-sm",
            "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50 appearance-none",
          )}
        >
          <option value="">{placeholder}</option>
          {keys.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
        <ChevronDown
          className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
          aria-hidden="true"
        />
      </div>

      {/* Selected badge */}
      {value && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
          <span>
            Using vault key: <code className="font-mono bg-muted px-1 rounded">{value}</code>
          </span>
        </div>
      )}

      {/* Create new secret toggle */}
      {!disabled && (
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          {showCreate ? "Hide create form" : "Create new secret"}
        </button>
      )}

      {/* Inline create form */}
      {showCreate && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2.5">
          <p className="text-xs font-medium text-foreground">New Vault Secret</p>
          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground" htmlFor={`${id ?? "vkp"}-new-key`}>
              Key name
            </label>
            <input
              id={`${id ?? "vkp"}-new-key`}
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="my_api_token"
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground" htmlFor={`${id ?? "vkp"}-new-value`}>
              Value
            </label>
            <input
              id={`${id ?? "vkp"}-new-value`}
              type="password"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Secret value"
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
            />
          </div>
          {createError && (
            <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">
              {createError}
            </p>
          )}
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || !newKey.trim() || !newValue}
            className={cn(
              "flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium",
              "hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {creating && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
            Save to Vault &amp; Select
          </button>
        </div>
      )}
    </div>
  );
}
