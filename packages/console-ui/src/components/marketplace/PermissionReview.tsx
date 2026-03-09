import { Database, Globe, Zap, Webhook, KeyRound, FolderOpen } from "lucide-react";

export interface ExtensionPermissions {
  database?: boolean;
  network?: string[];
  mcp?: boolean;
  hooks?: string[];
  vault?: string[];
  filesystem?: boolean;
}

interface PermissionRowProps {
  icon: React.ReactNode;
  label: string;
  detail?: string;
}

function PermissionRow({ icon, label, detail }: PermissionRowProps) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="mt-0.5 text-muted-foreground flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {detail && (
          <p className="text-xs text-muted-foreground mt-0.5 font-mono break-all">{detail}</p>
        )}
      </div>
    </div>
  );
}

interface PermissionReviewProps {
  permissions: ExtensionPermissions | undefined;
}

/**
 * Step 1 of install dialog: displays the permissions requested by an extension.
 */
export function PermissionReview({ permissions }: PermissionReviewProps) {
  if (!permissions) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        This extension does not request any special permissions.
      </p>
    );
  }

  const rows: React.ReactNode[] = [];

  if (permissions.database) {
    rows.push(
      <PermissionRow
        key="database"
        icon={<Database className="h-4 w-4" aria-hidden="true" />}
        label="Database"
        detail="Create and manage tables (project-scoped)"
      />,
    );
  }

  if (Array.isArray(permissions.network) && permissions.network.length > 0) {
    rows.push(
      <PermissionRow
        key="network"
        icon={<Globe className="h-4 w-4" aria-hidden="true" />}
        label="Network"
        detail={permissions.network.join(", ")}
      />,
    );
  }

  if (permissions.mcp) {
    rows.push(
      <PermissionRow
        key="mcp"
        icon={<Zap className="h-4 w-4" aria-hidden="true" />}
        label="MCP Server"
        detail="Connect to or spawn an MCP server"
      />,
    );
  }

  if (Array.isArray(permissions.hooks) && permissions.hooks.length > 0) {
    rows.push(
      <PermissionRow
        key="hooks"
        icon={<Webhook className="h-4 w-4" aria-hidden="true" />}
        label={`Hooks (${permissions.hooks.length})`}
        detail={permissions.hooks.join(", ")}
      />,
    );
  }

  if (Array.isArray(permissions.vault) && permissions.vault.length > 0) {
    rows.push(
      <PermissionRow
        key="vault"
        icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
        label="Vault Secrets"
        detail={`Needs: ${permissions.vault.join(", ")}`}
      />,
    );
  }

  if (permissions.filesystem) {
    rows.push(
      <PermissionRow
        key="filesystem"
        icon={<FolderOpen className="h-4 w-4" aria-hidden="true" />}
        label="Filesystem"
        detail="Read/write files beyond extension directory (advisory)"
      />,
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        This extension does not request any special permissions.
      </p>
    );
  }

  return (
    <div className="space-y-0 divide-y divide-border rounded-md border border-border bg-card px-3">
      {rows}
    </div>
  );
}
