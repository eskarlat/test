import { useEffect, useState } from "react";
import { useSearchParams, useParams } from "react-router";
import { Puzzle } from "lucide-react";
import { cn } from "../lib/utils";
import { useProjectStore } from "../stores/project-store";
import { useExtensionStore } from "../stores/extension-store";
import { useVaultStore } from "../stores/vault-store";
import { InstalledTab } from "../components/marketplace/InstalledTab";
import { MarketplaceTab } from "../components/marketplace/MarketplaceTab";
import { ExtensionSettingsPage } from "../components/marketplace/ExtensionSettingsPage";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";

type TabId = "installed" | "marketplace";

function TabError({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 space-y-2">
      <p className="text-sm font-medium text-foreground">Something went wrong</p>
      <p className="text-xs text-muted-foreground">{message}</p>
      <button
        onClick={resetErrorBoundary}
        className="text-xs text-muted-foreground hover:text-foreground underline"
      >
        Try again
      </button>
    </div>
  );
}

export default function ExtensionsPage() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const getExtensionsForProject = useExtensionStore((s) => s.getExtensionsForProject);
  const fetchExtensions = useExtensionStore((s) => s.fetchExtensions);
  const fetchVaultKeys = useVaultStore((s) => s.fetchKeys);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useParams<{ extensionName?: string }>();

  // Determine active tab from URL search param
  const rawTab = searchParams.get("tab");
  const activeTab: TabId =
    rawTab === "marketplace" ? "marketplace" : "installed";

  // Check if we're on the settings sub-page
  const settingsExtensionName = params["extensionName"];
  const isSettingsPage =
    typeof settingsExtensionName === "string" && settingsExtensionName.length > 0;

  const extensions = activeProjectId ? getExtensionsForProject(activeProjectId) : [];

  function setTab(tab: TabId) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  }

  useEffect(() => {
    async function load() {
      if (activeProjectId) {
        await Promise.all([fetchExtensions(activeProjectId), fetchVaultKeys()]);
      }
      setLoading(false);
    }
    void load();
  }, [activeProjectId, fetchExtensions, fetchVaultKeys]);

  // ─── Settings sub-page ────────────────────────────────────────────────────

  if (isSettingsPage) {
    const projectId =
      searchParams.get("project") ?? activeProjectId;

    if (!projectId) {
      return (
        <div className="max-w-2xl mx-auto">
          <p className="text-sm text-muted-foreground">No project selected.</p>
        </div>
      );
    }

    return (
      <ErrorBoundary FallbackComponent={TabError}>
        <ExtensionSettingsPage
          projectId={projectId}
          extensionName={settingsExtensionName!}
        />
      </ErrorBoundary>
    );
  }

  // ─── No project selected ──────────────────────────────────────────────────

  if (!activeProjectId) {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground mb-2">Extension Manager</h1>
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <Puzzle className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Select a project to manage its extensions.
          </p>
        </div>
      </div>
    );
  }

  // ─── Main tab layout ──────────────────────────────────────────────────────

  const installedCount = extensions.length;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Extension Manager</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse, install, and manage extensions for this project.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border pb-0">
        <button
          onClick={() => setTab("installed")}
          aria-selected={activeTab === "installed"}
          role="tab"
          className={cn(
            "px-4 py-2 text-sm font-medium rounded-t-md transition-colors",
            "-mb-px border-b-2",
            activeTab === "installed"
              ? "text-foreground border-primary"
              : "text-muted-foreground border-transparent hover:text-foreground",
          )}
        >
          Installed
          {installedCount > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground">({installedCount})</span>
          )}
        </button>
        <button
          onClick={() => setTab("marketplace")}
          aria-selected={activeTab === "marketplace"}
          role="tab"
          className={cn(
            "px-4 py-2 text-sm font-medium rounded-t-md transition-colors",
            "-mb-px border-b-2",
            activeTab === "marketplace"
              ? "text-foreground border-primary"
              : "text-muted-foreground border-transparent hover:text-foreground",
          )}
        >
          Marketplace
        </button>
      </div>

      {/* Tab content */}
      <ErrorBoundary FallbackComponent={TabError}>
        {activeTab === "installed" && (
          <InstalledTab
            projectId={activeProjectId}
            loading={loading}
            extensions={extensions}
          />
        )}
        {activeTab === "marketplace" && (
          <MarketplaceTab projectId={activeProjectId} />
        )}
      </ErrorBoundary>
    </div>
  );
}
