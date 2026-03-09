import { useState, useEffect, useCallback } from "react";
import { KeyRound, Plus, AlertCircle } from "lucide-react";
import { VaultKeyList } from "../components/vault/VaultKeyList";
import { AddSecretForm } from "../components/vault/AddSecretForm";
import { apiPost, apiDelete } from "../api/client";
import { useVaultStore } from "../stores/vault-store";
import { useNotificationStore } from "../stores/notification-store";

export default function VaultPage() {
  const keys = useVaultStore((s) => s.keys);
  const fetchKeys = useVaultStore((s) => s.fetchKeys);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    await fetchKeys();
    setLoading(false);
  }, [fetchKeys]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  async function handleSave(key: string, value: string) {
    setSaving(true);
    setSaveError(null);
    const result = await apiPost<{ ok: boolean }>("/api/vault/secrets", { key, value });
    if (result.error) {
      setSaveError(result.error);
    } else {
      useNotificationStore.getState().addToast(`Vault key "${key}" saved`, "success");
      setShowAddForm(false);
      await fetchKeys();
    }
    setSaving(false);
  }

  async function handleDelete(key: string) {
    setDeletingKey(key);
    const result = await apiDelete<{ ok: boolean }>(
      `/api/vault/secrets/${encodeURIComponent(key)}`
    );
    if (result.error) {
      useNotificationStore
        .getState()
        .addToast(`Failed to delete "${key}": ${result.error}`, "error");
    } else {
      useNotificationStore.getState().addToast(`Vault key "${key}" deleted`, "success");
      await fetchKeys();
    }
    setDeletingKey(null);
  }

  function handleCancelAdd() {
    setShowAddForm(false);
    setSaveError(null);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-foreground">Vault</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage encrypted secrets used by extensions.
          </p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add Secret
          </button>
        )}
      </div>

      {showAddForm && (
        <AddSecretForm
          saving={saving}
          error={saveError}
          onSave={handleSave}
          onCancel={handleCancelAdd}
        />
      )}

      <VaultKeyList
        loading={loading}
        keys={keys}
        deletingKey={deletingKey}
        onDelete={(key) => void handleDelete(key)}
      />

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start gap-2">
          <AlertCircle
            className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Secrets are encrypted with AES-256-GCM using a machine-derived key.</p>
            <p>
              Reference vault keys in extension settings using{" "}
              <code className="font-mono bg-muted px-1 rounded">{"${VAULT:KEY_NAME}"}</code>.
            </p>
            <p>Secret values are never displayed — only key names are shown.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
