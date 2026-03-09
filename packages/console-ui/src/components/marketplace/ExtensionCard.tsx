import {
  Puzzle,
  CheckCircle2,
  XCircle,
  Info,
  ArrowUp,
  Database,
  Globe,
  Zap,
  Webhook,
  KeyRound,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { ExtensionPermissions } from "./PermissionReview";

export type ExtensionStatus = "healthy" | "needs-setup" | "error" | "disabled" | "update-available";

function StatusBadge({ status }: { status: ExtensionStatus }) {
  if (status === "healthy") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        Healthy
      </span>
    );
  }
  if (status === "needs-setup") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-1.5 py-0.5">
        <Info className="h-3 w-3" aria-hidden="true" />
        Needs setup
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
        <XCircle className="h-3 w-3" aria-hidden="true" />
        Error
      </span>
    );
  }
  if (status === "disabled") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted border border-border rounded px-1.5 py-0.5">
        Disabled
      </span>
    );
  }
  if (status === "update-available") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
        <ArrowUp className="h-3 w-3" aria-hidden="true" />
        Update available
      </span>
    );
  }
  return null;
}

function PermissionsCompact({ permissions }: { permissions: ExtensionPermissions | undefined }) {
  if (!permissions) return null;
  const icons: React.ReactNode[] = [];
  if (permissions.database) {
    icons.push(
      <span key="db" title="Database" className="text-muted-foreground">
        <Database className="h-3 w-3" aria-hidden="true" />
      </span>,
    );
  }
  if (Array.isArray(permissions.network) && permissions.network.length > 0) {
    icons.push(
      <span key="net" title={`Network: ${permissions.network.join(", ")}`} className="text-muted-foreground">
        <Globe className="h-3 w-3" aria-hidden="true" />
      </span>,
    );
  }
  if (permissions.mcp) {
    icons.push(
      <span key="mcp" title="MCP" className="text-muted-foreground">
        <Zap className="h-3 w-3" aria-hidden="true" />
      </span>,
    );
  }
  if (Array.isArray(permissions.hooks) && permissions.hooks.length > 0) {
    icons.push(
      <span key="hooks" title={`Hooks: ${permissions.hooks.join(", ")}`} className="text-muted-foreground">
        <Webhook className="h-3 w-3" aria-hidden="true" />
      </span>,
    );
  }
  if (Array.isArray(permissions.vault) && permissions.vault.length > 0) {
    icons.push(
      <span key="vault" title={`Vault: ${permissions.vault.join(", ")}`} className="text-muted-foreground">
        <KeyRound className="h-3 w-3" aria-hidden="true" />
      </span>,
    );
  }

  if (icons.length === 0) return null;
  return <div className="flex items-center gap-1.5">{icons}</div>;
}

// ─── Installed variant ────────────────────────────────────────────────────────

export interface InstalledExtensionCardData {
  name: string;
  displayName?: string;
  version: string;
  status: ExtensionStatus;
  mcpTransport?: string;
  mcpStatus?: string;
  marketplace?: string;
  description?: string;
  error?: string;
  hasSettings: boolean;
  updateAvailable?: { version: string };
  permissions?: ExtensionPermissions;
}

interface InstalledCardProps {
  extension: InstalledExtensionCardData;
  onSettings: () => void;
  onDisable: () => void;
  onEnable: () => void;
  onRemove: () => void;
  onUpgrade: () => void;
  toggling: boolean;
}

export function InstalledExtensionCard({
  extension,
  onSettings,
  onDisable,
  onEnable,
  onRemove,
  onUpgrade,
  toggling,
}: InstalledCardProps) {
  const isEnabled = extension.status !== "disabled";
  const isNeedsSetup = extension.status === "needs-setup";
  const activeLabel = isEnabled ? "Disable" : "Enable";
  const toggleLabel = toggling ? "..." : activeLabel;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <Puzzle
          className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {extension.displayName ?? extension.name}
            </h3>
            <span className="text-xs text-muted-foreground font-mono">v{extension.version}</span>
            <StatusBadge status={extension.status} />
            {extension.updateAvailable && (
              <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                <ArrowUp className="h-3 w-3" aria-hidden="true" />
                v{extension.updateAvailable.version}
              </span>
            )}
          </div>

          {extension.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{extension.description}</p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {extension.mcpTransport && (
              <span>
                MCP: {extension.mcpTransport}
                {extension.mcpStatus ? ` (${extension.mcpStatus})` : ""}
              </span>
            )}
            {extension.marketplace && <span>Source: {extension.marketplace}</span>}
            <PermissionsCompact permissions={extension.permissions} />
          </div>

          {isNeedsSetup && (
            <p className="mt-1.5 text-xs text-yellow-700 flex items-center gap-1">
              <Info className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
              Needs setup — required settings missing
            </p>
          )}

          {extension.error && (
            <p className="mt-1 text-xs text-destructive">{extension.error}</p>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        {extension.hasSettings && (
          <button
            onClick={onSettings}
            className={cn(
              "flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
              isNeedsSetup && "border-yellow-300 text-yellow-700 hover:bg-yellow-50",
            )}
          >
            Settings
            {isNeedsSetup && <Info className="h-3 w-3" aria-hidden="true" />}
          </button>
        )}

        <button
          onClick={isEnabled ? onDisable : onEnable}
          disabled={toggling}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
        >
          {toggleLabel}
        </button>

        {extension.updateAvailable && (
          <button
            onClick={onUpgrade}
            className="flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 transition-colors"
          >
            <ArrowUp className="h-3 w-3" aria-hidden="true" />
            Upgrade
          </button>
        )}

        <button
          onClick={onRemove}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/30 hover:bg-destructive/5 transition-colors"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

// ─── Marketplace variant ──────────────────────────────────────────────────────

export interface MarketplaceExtensionCardData {
  name: string;
  version: string;
  description?: string;
  tags?: string[];
  author?: string;
  marketplace?: string;
  permissions?: ExtensionPermissions;
  installed?: boolean;
}

interface MarketplaceCardProps {
  extension: MarketplaceExtensionCardData;
  onInstall: () => void;
}

export function MarketplaceExtensionCard({ extension, onInstall }: MarketplaceCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <Puzzle
          className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground truncate">{extension.name}</h3>
            <span className="text-xs text-muted-foreground font-mono">v{extension.version}</span>
            {extension.installed && (
              <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                Installed
              </span>
            )}
          </div>

          {extension.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{extension.description}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {extension.marketplace && (
              <span className="text-xs text-muted-foreground">
                {extension.marketplace}
              </span>
            )}
            {extension.author && (
              <span className="text-xs text-muted-foreground">Author: {extension.author}</span>
            )}
            {Array.isArray(extension.tags) && extension.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {extension.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <PermissionsCompact permissions={extension.permissions} />
          </div>
        </div>

        <div className="flex-shrink-0">
          {extension.installed ? (
            <span className="text-xs text-muted-foreground px-2">Installed</span>
          ) : (
            <button
              onClick={onInstall}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              Install
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
