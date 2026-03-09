import { useState } from "react";
import { Puzzle, Loader2 } from "lucide-react";
import { useNavigate } from "react-router";
import { apiPost, apiDelete } from "../../api/client";
import { useExtensionStore, type MountedExtension } from "../../stores/extension-store";
import { useNotificationStore } from "../../stores/notification-store";
import { useProjectStore } from "../../stores/project-store";
import {
  InstalledExtensionCard,
  type InstalledExtensionCardData,
  type ExtensionStatus,
} from "./ExtensionCard";
import { RemoveDialog } from "./RemoveDialog";
import { UpgradeDialog } from "./UpgradeDialog";

function deriveStatus(ext: MountedExtension): ExtensionStatus {
  if (ext.status === "disabled") return "disabled";
  if (ext.status === "needs-setup" || ext.status === "needs_setup") return "needs-setup";
  if (ext.status === "failed" || ext.status === "error" || ext.status === "suspended") {
    return "error";
  }
  return "healthy";
}

function toCardData(
  ext: MountedExtension,
  updateVersion?: string,
): InstalledExtensionCardData {
  const base: InstalledExtensionCardData = {
    name: ext.name,
    version: ext.version,
    status: deriveStatus(ext),
    hasSettings: (ext.manifest?.settings?.schema.length ?? 0) > 0,
  };

  if (ext.displayName !== undefined) base.displayName = ext.displayName;
  if (ext.mcpTransport !== undefined) base.mcpTransport = ext.mcpTransport;
  if (ext.mcpStatus !== undefined) base.mcpStatus = ext.mcpStatus;
  if (ext.source !== undefined) base.marketplace = ext.source;
  if (ext.marketplace !== undefined) base.marketplace = ext.marketplace;
  if (ext.description !== undefined) base.description = ext.description;
  if (ext.manifest?.description !== undefined) base.description = ext.manifest.description;
  if (ext.error !== undefined) base.error = ext.error;
  if (updateVersion !== undefined) base.updateAvailable = { version: updateVersion };
  if (ext.manifest?.permissions !== undefined) {
    base.permissions = ext.manifest.permissions;
  }

  return base;
}

interface InstalledTabProps {
  projectId: string;
  loading: boolean;
  extensions: MountedExtension[];
}

export function InstalledTab({ projectId, loading, extensions }: InstalledTabProps) {
  const navigate = useNavigate();
  const fetchExtensions = useExtensionStore((s) => s.fetchExtensions);
  const availableUpdates = useNotificationStore((s) => s.availableUpdates);

  const [togglingName, setTogglingName] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [upgradeTarget, setUpgradeTarget] = useState<{
    name: string;
    current: string;
    target: string;
  } | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  async function refresh() {
    await fetchExtensions(projectId);
  }

  async function handleDisable(name: string) {
    setTogglingName(name);
    const result = await apiPost<{ ok: boolean }>(
      `/api/projects/${projectId}/extensions/${name}/disable`,
      {},
    );
    if (result.error) {
      useNotificationStore
        .getState()
        .addToast(`Failed to disable ${name}: ${result.error}`, "error");
    } else {
      useNotificationStore.getState().addToast(`${name} disabled`, "success");
      await refresh();
    }
    setTogglingName(null);
  }

  async function handleEnable(name: string) {
    setTogglingName(name);
    const result = await apiPost<{ ok: boolean }>(
      `/api/projects/${projectId}/extensions/${name}/enable`,
      {},
    );
    if (result.error) {
      useNotificationStore
        .getState()
        .addToast(`Failed to enable ${name}: ${result.error}`, "error");
    } else {
      useNotificationStore.getState().addToast(`${name} enabled`, "success");
      await refresh();
    }
    setTogglingName(null);
  }

  async function handleRemoveConfirm() {
    if (!removeTarget) return;
    setRemoving(true);
    const result = await apiDelete<{ ok: boolean }>(
      `/api/${projectId}/extensions/${encodeURIComponent(removeTarget)}`,
    );
    if (result.error) {
      useNotificationStore
        .getState()
        .addToast(`Failed to remove ${removeTarget}: ${result.error}`, "error");
    } else {
      useNotificationStore.getState().addToast(`${removeTarget} removed`, "success");
      // Refresh project store to update extension counts
      await useProjectStore.getState().fetchProjects();
      await refresh();
    }
    setRemoving(false);
    setRemoveTarget(null);
  }

  async function handleUpgradeConfirm() {
    if (!upgradeTarget) return;
    setUpgrading(true);
    const result = await apiPost<{ ok: boolean }>(
      `/api/${projectId}/extensions/${encodeURIComponent(upgradeTarget.name)}/upgrade`,
      { version: upgradeTarget.target },
    );
    if (result.error) {
      useNotificationStore
        .getState()
        .addToast(
          `Failed to upgrade ${upgradeTarget.name}: ${result.error}`,
          "error",
        );
    } else {
      useNotificationStore
        .getState()
        .addToast(
          `${upgradeTarget.name} upgraded to v${upgradeTarget.target}`,
          "success",
        );
      await refresh();
    }
    setUpgrading(false);
    setUpgradeTarget(null);
  }

  function handleSettings(name: string) {
    void navigate(`/extensions/settings/${name}?project=${projectId}`);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading extensions...
      </div>
    );
  }

  if (extensions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center">
        <Puzzle className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">No extensions installed</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Browse the Marketplace tab to install extensions.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {extensions.map((ext) => {
          const update = availableUpdates.find((u) => u.name === ext.name);
          const cardData = toCardData(ext, update?.latest);

          return (
            <InstalledExtensionCard
              key={ext.name}
              extension={cardData}
              onSettings={() => handleSettings(ext.name)}
              onDisable={() => void handleDisable(ext.name)}
              onEnable={() => void handleEnable(ext.name)}
              onRemove={() => setRemoveTarget(ext.name)}
              onUpgrade={() => {
                if (update) {
                  setUpgradeTarget({
                    name: ext.name,
                    current: ext.version,
                    target: update.latest,
                  });
                }
              }}
              toggling={togglingName === ext.name}
            />
          );
        })}
      </div>

      {/* Remove confirmation dialog */}
      {removeTarget && (
        <RemoveDialog
          extensionName={removeTarget}
          removing={removing}
          onConfirm={() => void handleRemoveConfirm()}
          onClose={() => {
            if (!removing) setRemoveTarget(null);
          }}
        />
      )}

      {/* Upgrade confirmation dialog */}
      {upgradeTarget && (
        <UpgradeDialog
          extensionName={upgradeTarget.name}
          currentVersion={upgradeTarget.current}
          targetVersion={upgradeTarget.target}
          upgrading={upgrading}
          onConfirm={() => void handleUpgradeConfirm()}
          onClose={() => {
            if (!upgrading) setUpgradeTarget(null);
          }}
        />
      )}
    </>
  );
}
