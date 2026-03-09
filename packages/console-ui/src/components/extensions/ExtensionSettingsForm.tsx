import { useState, useEffect } from "react";
import { Save, Loader2, WifiOff } from "lucide-react";
import { apiGet, apiPut } from "../../api/client";
import { useConnectionStore } from "../../stores/connection-store";
import { useVaultStore } from "../../stores/vault-store";
import { useNotificationStore } from "../../stores/notification-store";
import type { MountedExtension } from "../../stores/extension-store";

interface ExtensionSettingsFormProps {
  projectId: string;
  extension: MountedExtension;
}

function SaveButtonContent({ saving, disconnected }: { saving: boolean; disconnected: boolean }) {
  if (saving) {
    return (
      <>
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Saving...
      </>
    );
  }
  if (disconnected) {
    return (
      <>
        <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
        Server offline
      </>
    );
  }
  return (
    <>
      <Save className="h-3.5 w-3.5" aria-hidden="true" />
      Save Settings
    </>
  );
}

type FieldValue = string | number | boolean;

export function ExtensionSettingsForm({ projectId, extension }: ExtensionSettingsFormProps) {
  const schema = extension.manifest?.settings?.schema ?? [];
  const status = useConnectionStore((s) => s.status);
  const vaultKeys = useVaultStore((s) => s.keys);

  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSettings() {
      setLoading(true);
      const result = await apiGet<Record<string, FieldValue>>(
        `/api/${projectId}/extensions/${extension.name}/settings`
      );
      if (result.data) {
        setValues(result.data);
      } else {
        // Initialize with defaults from schema
        const defaults: Record<string, FieldValue> = {};
        for (const field of schema) {
          if (field.required !== true) continue;
          defaults[field.key] = "";
        }
        setValues(defaults);
      }
      setLoading(false);
    }
    void loadSettings();
  }, [projectId, extension.name, schema]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (status === "disconnected") return;

    setSaving(true);
    setError(null);

    const result = await apiPut<{ message: string }>(
      `/api/${projectId}/extensions/${extension.name}/settings`,
      values
    );

    if (result.error) {
      if (result.status === 503) {
        setError("Server is unavailable. Settings not saved.");
      } else {
        setError(result.error);
      }
    } else {
      useNotificationStore.getState().addToast(
        `Settings saved for ${extension.name}`,
        "success"
      );
    }
    setSaving(false);
  }

  function setFieldValue(key: string, value: FieldValue) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading settings...
      </div>
    );
  }

  if (schema.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        This extension has no configurable settings.
      </p>
    );
  }

  return (
    <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
      {schema.map((field) => (
        <div key={field.key} className="space-y-1">
          <label
            htmlFor={`setting-${field.key}`}
            className="block text-sm font-medium text-foreground"
          >
            {field.label ?? field.key}
            {field.required && (
              <span className="ml-1 text-destructive" aria-hidden="true">*</span>
            )}
          </label>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}

          {field.type === "string" && (
            <input
              id={`setting-${field.key}`}
              type="text"
              value={(values[field.key] as string | undefined) ?? ""}
              onChange={(e) => setFieldValue(field.key, e.target.value)}
              disabled={status === "disconnected"}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          )}

          {field.type === "vault" && (
            <select
              id={`setting-${field.key}`}
              value={(values[field.key] as string | undefined) ?? ""}
              onChange={(e) => setFieldValue(field.key, e.target.value)}
              disabled={status === "disconnected"}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Select vault key...</option>
              {vaultKeys.map((key) => (
                <option key={key} value={`\${VAULT:${key}}`}>
                  {key}
                </option>
              ))}
              <option value="__create_new__">+ Create new secret</option>
            </select>
          )}

          {field.type === "number" && (
            <input
              id={`setting-${field.key}`}
              type="number"
              value={(values[field.key] as number | undefined) ?? 0}
              onChange={(e) => setFieldValue(field.key, Number(e.target.value))}
              disabled={status === "disconnected"}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          )}

          {field.type === "boolean" && (
            <div className="flex items-center gap-2">
              <input
                id={`setting-${field.key}`}
                type="checkbox"
                checked={(values[field.key] as boolean | undefined) ?? false}
                onChange={(e) => setFieldValue(field.key, e.target.checked)}
                disabled={status === "disconnected"}
                className="h-4 w-4 rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span className="text-sm text-muted-foreground">Enabled</span>
            </div>
          )}

          {field.type === "select" && field.options && (
            <select
              id={`setting-${field.key}`}
              value={(values[field.key] as string | undefined) ?? ""}
              onChange={(e) => setFieldValue(field.key, e.target.value)}
              disabled={status === "disconnected"}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Select option...</option>
              {field.options.map((opt) => (
                <option key={typeof opt === "string" ? opt : opt.value} value={typeof opt === "string" ? opt : opt.value}>
                  {typeof opt === "string" ? opt : opt.label}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}

      {error && (
        <p className="text-sm text-destructive rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving || status === "disconnected"}
        className="flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        <SaveButtonContent saving={saving} disconnected={status === "disconnected"} />
      </button>
    </form>
  );
}
