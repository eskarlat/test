import { CheckCircle2 } from "lucide-react";
import type { ExtensionPermissions } from "./PermissionReview";
import type { SettingField, SettingsValues } from "./SettingsStep";

interface MarketplaceExtensionSummary {
  name: string;
  version: string;
  marketplace?: string;
  description?: string;
  permissions?: ExtensionPermissions;
}

interface ConfirmInstallProps {
  extension: MarketplaceExtensionSummary;
  schema: SettingField[];
  values: SettingsValues;
}

function PermissionsSummary({ permissions }: { permissions: ExtensionPermissions | undefined }) {
  if (!permissions) return <span className="text-muted-foreground">None</span>;

  const parts: string[] = [];
  if (permissions.database) parts.push("Database");
  if (Array.isArray(permissions.network) && permissions.network.length > 0) {
    parts.push(`Network (${permissions.network.length})`);
  }
  if (permissions.mcp) parts.push("MCP");
  if (Array.isArray(permissions.hooks) && permissions.hooks.length > 0) {
    parts.push(`Hooks (${permissions.hooks.length})`);
  }
  if (Array.isArray(permissions.vault) && permissions.vault.length > 0) {
    parts.push(`Vault (${permissions.vault.length})`);
  }
  if (permissions.filesystem) parts.push("Filesystem");

  if (parts.length === 0) return <span className="text-muted-foreground">None</span>;
  return <span>{parts.join(", ")}</span>;
}

function SettingsSummary({
  schema,
  values,
}: {
  schema: SettingField[];
  values: SettingsValues;
}) {
  if (schema.length === 0) return <span className="text-muted-foreground">None</span>;

  return (
    <ul className="space-y-0.5">
      {schema.map((field) => {
        const v = values[field.key];
        let display: string;
        if (v === undefined || v === "" || v === null) {
          display = field.required ? "(required — not set)" : "(optional — not set)";
        } else if (field.type === "vault" && typeof v === "string") {
          // Show "key_name" from "${VAULT:key_name}"
          const match = /^\$\{VAULT:(.+)\}$/.exec(v);
          display = match ? `vault: ${match[1]}` : String(v);
        } else {
          display = String(v);
        }

        return (
          <li key={field.key} className="flex gap-2 text-sm">
            <span className="font-mono text-muted-foreground min-w-0 truncate">
              {field.key}
            </span>
            <span className="text-foreground">{display}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Step 3 of the install dialog: confirmation summary before installation.
 */
export function ConfirmInstall({ extension, schema, values }: ConfirmInstallProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card p-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold text-foreground">
            {extension.name} v{extension.version}
          </span>
        </div>
        {extension.description && (
          <p className="text-xs text-muted-foreground">{extension.description}</p>
        )}
        {extension.marketplace && (
          <p className="text-xs text-muted-foreground">
            Source: <span className="font-medium">{extension.marketplace}</span>
          </p>
        )}
      </div>

      <div className="space-y-3 text-sm">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Permissions
          </p>
          <PermissionsSummary permissions={extension.permissions} />
        </div>

        {schema.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Settings
            </p>
            <SettingsSummary schema={schema} values={values} />
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            This will
          </p>
          <ul className="space-y-0.5 text-sm text-muted-foreground list-none">
            <li className="flex items-start gap-1.5">
              <span className="mt-1 text-green-600">•</span>
              Mount extension routes in worker service
            </li>
            <li className="flex items-start gap-1.5">
              <span className="mt-1 text-green-600">•</span>
              Add hooks to .github/hooks/ (if declared)
            </li>
            <li className="flex items-start gap-1.5">
              <span className="mt-1 text-green-600">•</span>
              Add skills to .github/skills/ (if declared)
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
