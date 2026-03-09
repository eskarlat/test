import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  ArrowLeft,
  Save,
  Loader2,
  AlertTriangle,
  Info,
  Database,
  Globe,
  Zap,
  Webhook,
  KeyRound,
  FolderOpen,
} from "lucide-react";
import { apiGet, apiPut } from "../../api/client";
import { useNotificationStore } from "../../stores/notification-store";
import { useConnectionStore } from "../../stores/connection-store";
import { VaultKeyPicker } from "./VaultKeyPicker";
import { cn } from "../../lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type SettingPrimitive = string | number | boolean;

interface SettingDefinition {
  key: string;
  type: string;
  label?: string;
  description?: string;
  required?: boolean;
  default?: SettingPrimitive;
  options?: string[] | { label: string; value: string }[];
  placeholder?: string;
}

interface ExtensionPermissions {
  database?: boolean;
  network?: string[];
  mcp?: boolean;
  hooks?: string[];
  vault?: string[];
  filesystem?: boolean;
}

interface ExtensionInfo {
  name: string;
  version: string;
  source?: string;
  marketplace?: string;
  author?: string;
  installedAt?: string;
  status?: string;
  manifest?: {
    settings?: { schema: SettingDefinition[] };
    permissions?: ExtensionPermissions;
    description?: string;
  };
}

interface SettingsResponse {
  settings: Record<string, SettingPrimitive>;
  schema: SettingDefinition[];
}

// ─── Permission display ───────────────────────────────────────────────────────

function PermissionsDisplay({ permissions }: { permissions: ExtensionPermissions | undefined }) {
  if (!permissions) return null;
  const rows: React.ReactNode[] = [];

  if (permissions.database) {
    rows.push(
      <div key="db" className="flex items-start gap-2 py-1.5 text-sm">
        <Database className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>Database — project-scoped read/write</span>
      </div>,
    );
  }
  if (Array.isArray(permissions.network) && permissions.network.length > 0) {
    rows.push(
      <div key="net" className="flex items-start gap-2 py-1.5 text-sm">
        <Globe className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>Network — {permissions.network.join(", ")}</span>
      </div>,
    );
  }
  if (permissions.mcp) {
    rows.push(
      <div key="mcp" className="flex items-start gap-2 py-1.5 text-sm">
        <Zap className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>MCP Server</span>
      </div>,
    );
  }
  if (Array.isArray(permissions.hooks) && permissions.hooks.length > 0) {
    rows.push(
      <div key="hooks" className="flex items-start gap-2 py-1.5 text-sm">
        <Webhook className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>Hooks — {permissions.hooks.join(", ")}</span>
      </div>,
    );
  }
  if (Array.isArray(permissions.vault) && permissions.vault.length > 0) {
    rows.push(
      <div key="vault" className="flex items-start gap-2 py-1.5 text-sm">
        <KeyRound className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>Vault — {permissions.vault.join(", ")}</span>
      </div>,
    );
  }
  if (permissions.filesystem) {
    rows.push(
      <div key="fs" className="flex items-start gap-2 py-1.5 text-sm">
        <FolderOpen className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>Filesystem (advisory)</span>
      </div>,
    );
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No special permissions declared.</p>;
  }

  return <div className="divide-y divide-border">{rows}</div>;
}

// ─── Settings form ────────────────────────────────────────────────────────────

const inputCls = cn(
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
  "ring-offset-background placeholder:text-muted-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

interface SettingsFormProps {
  projectId: string;
  extensionName: string;
  schema: SettingDefinition[];
  initialValues: Record<string, SettingPrimitive>;
  disabled: boolean;
  onSaved: () => void;
}

function SettingsForm({
  projectId,
  extensionName,
  schema,
  initialValues,
  disabled,
  onSaved,
}: SettingsFormProps) {
  const [values, setValues] = useState<Record<string, SettingPrimitive>>(initialValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update when initial values change
  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  function setField(key: string, value: SettingPrimitive) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setSaving(true);
    setError(null);

    const result = await apiPut<{ ok: boolean; message?: string }>(
      `/api/projects/${projectId}/extensions/${extensionName}/settings`,
      values,
    );

    if (result.error) {
      setError(
        result.status === 503
          ? "Server is unavailable. Settings not saved."
          : result.error,
      );
    } else {
      useNotificationStore
        .getState()
        .addToast(`Settings saved for ${extensionName} — remounting...`, "success");
      onSaved();
    }
    setSaving(false);
  }

  if (schema.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        This extension has no configurable settings.
      </p>
    );
  }

  return (
    <form onSubmit={(e) => void handleSave(e)} className="space-y-5">
      {schema.map((field) => {
        const fieldId = `settings-${field.key}`;
        const value = values[field.key];

        return (
          <div key={field.key} className="space-y-1.5">
            <label htmlFor={fieldId} className="block text-sm font-medium text-foreground">
              {field.label ?? field.key}
              {field.required && (
                <span className="ml-1 text-destructive" aria-hidden="true">
                  *
                </span>
              )}
            </label>
            {field.description && (
              <p className="text-xs text-muted-foreground">{field.description}</p>
            )}

            {field.type === "vault" && (
              <VaultKeyPicker
                id={fieldId}
                disabled={disabled}
                value={
                  typeof value === "string" ? value.replace(/^\$\{VAULT:(.+)\}$/, "$1") : ""
                }
                onChange={(key) => setField(field.key, key ? `\${VAULT:${key}}` : "")}
              />
            )}

            {field.type === "string" && (
              <input
                id={fieldId}
                type="text"
                value={(value as string | undefined) ?? ""}
                onChange={(e) => setField(field.key, e.target.value)}
                disabled={disabled}
                placeholder={field.placeholder}
                className={inputCls}
              />
            )}

            {field.type === "number" && (
              <input
                id={fieldId}
                type="number"
                value={(value as number | undefined) ?? (typeof field.default === "number" ? field.default : 0)}
                onChange={(e) => setField(field.key, Number(e.target.value))}
                disabled={disabled}
                className={inputCls}
              />
            )}

            {field.type === "boolean" && (
              <div className="flex items-center gap-2">
                <input
                  id={fieldId}
                  type="checkbox"
                  checked={(value as boolean | undefined) ?? field.default === true}
                  onChange={(e) => setField(field.key, e.target.checked)}
                  disabled={disabled}
                  className="h-4 w-4 rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span className="text-sm text-muted-foreground">Enable</span>
              </div>
            )}

            {field.type === "select" && Array.isArray(field.options) && (
              <select
                id={fieldId}
                value={(value as string | undefined) ?? ""}
                onChange={(e) => setField(field.key, e.target.value)}
                disabled={disabled}
                className={inputCls}
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
        );
      })}

      {/* Remount warning */}
      <div className="flex items-start gap-2 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2">
        <AlertTriangle
          className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <p className="text-xs text-yellow-800">
          Saving will remount the extension (~1-3 sec). In-flight requests will receive 503.
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || disabled}
          className="flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              Save Settings
            </>
          )}
        </button>
      </div>
    </form>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

interface ExtensionSettingsPageProps {
  projectId: string;
  extensionName: string;
}

export function ExtensionSettingsPage({
  projectId,
  extensionName,
}: ExtensionSettingsPageProps) {
  const navigate = useNavigate();
  const connectionStatus = useConnectionStore((s) => s.status);
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<ExtensionInfo | null>(null);
  const [settingsData, setSettingsData] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);

    // Load settings + schema
    const settingsResult = await apiGet<SettingsResponse>(
      `/api/projects/${projectId}/extensions/${extensionName}/settings`,
    );

    // Load extension info (may not exist for all versions)
    const infoResult = await apiGet<ExtensionInfo>(
      `/api/${projectId}/extensions/${extensionName}/info`,
    );

    if (settingsResult.error && infoResult.error) {
      setError(`Failed to load extension: ${settingsResult.error}`);
    } else {
      setSettingsData(settingsResult.data);
      setInfo(infoResult.data ?? null);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, [projectId, extensionName]); // loadData is recreated on projectId/extensionName change

  const schema = settingsData?.schema ?? info?.manifest?.settings?.schema ?? [];
  const permissions = info?.manifest?.permissions;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back navigation */}
      <button
        onClick={() => void navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back
      </button>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{extensionName} — Settings</h1>
        {info && (
          <p className="mt-1 text-sm text-muted-foreground">
            v{info.version}
            {info.marketplace && ` · ${info.marketplace}`}
          </p>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading settings...
        </div>
      )}

      {error && !loading && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Settings form */}
          <div className="rounded-lg border border-border bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Configuration</h2>
            <SettingsForm
              projectId={projectId}
              extensionName={extensionName}
              schema={schema}
              initialValues={settingsData?.settings ?? {}}
              disabled={connectionStatus === "disconnected"}
              onSaved={() => void loadData()}
            />
          </div>

          {/* Permissions (read-only) */}
          {permissions && (
            <div className="rounded-lg border border-border bg-card p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-foreground">Permissions</h2>
              </div>
              <PermissionsDisplay permissions={permissions} />
            </div>
          )}

          {/* Extension info */}
          {info && (
            <div className="rounded-lg border border-border bg-card p-5 space-y-2">
              <h2 className="text-sm font-semibold text-foreground">Extension Info</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Version</dt>
                <dd className="font-mono text-foreground">{info.version}</dd>
                {info.source && (
                  <>
                    <dt className="text-muted-foreground">Source</dt>
                    <dd className="text-foreground truncate">{info.source}</dd>
                  </>
                )}
                {info.marketplace && (
                  <>
                    <dt className="text-muted-foreground">Marketplace</dt>
                    <dd className="text-foreground">{info.marketplace}</dd>
                  </>
                )}
                {info.installedAt && (
                  <>
                    <dt className="text-muted-foreground">Installed</dt>
                    <dd className="text-foreground">
                      {new Date(info.installedAt).toLocaleDateString()}
                    </dd>
                  </>
                )}
                {info.status && (
                  <>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="text-foreground">{info.status}</dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </>
      )}
    </div>
  );
}
