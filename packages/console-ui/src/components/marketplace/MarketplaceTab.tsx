import { useState, useEffect, useMemo } from "react";
import { Search, Loader2, AlertCircle, RefreshCw, ChevronDown } from "lucide-react";
import { apiGet } from "../../api/client";
import { MarketplaceExtensionCard, type MarketplaceExtensionCardData } from "./ExtensionCard";
import { InstallDialog, type MarketplaceExtensionForInstall } from "./InstallDialog";
import { useExtensionStore } from "../../stores/extension-store";
import { cn } from "../../lib/utils";

interface MarketplaceEntry extends MarketplaceExtensionCardData {
  repository: string;
  settings?: {
    schema: Array<{
      key: string;
      type: string;
      label?: string;
      required?: boolean;
      description?: string;
      options?: string[] | { label: string; value: string }[];
      placeholder?: string;
      default?: string | number | boolean;
    }>;
  };
}

interface MarketplaceResponse {
  extensions: Array<MarketplaceEntry & { marketplace: string }>;
  marketplaces: Array<{ name: string; url: string }>;
  fetchedAt: string;
}

interface MarketplaceTabProps {
  projectId: string;
}

export function MarketplaceTab({ projectId }: MarketplaceTabProps) {
  const [extensions, setExtensions] = useState<Array<MarketplaceEntry & { marketplace: string }>>(
    [],
  );
  const [marketplaceNames, setMarketplaceNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMarketplace, setSelectedMarketplace] = useState("__all__");
  const [installTarget, setInstallTarget] = useState<MarketplaceExtensionForInstall | null>(null);

  const fetchExtensions = useExtensionStore((s) => s.fetchExtensions);
  const installedExtensions = useExtensionStore((s) => s.getExtensionsForProject(projectId));
  const installedNames = useMemo(
    () => new Set(installedExtensions.map((e) => e.name)),
    [installedExtensions],
  );

  async function loadMarketplace() {
    setLoading(true);
    setError(null);
    const result = await apiGet<MarketplaceResponse>("/api/marketplace");
    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      setExtensions(result.data.extensions);
      setMarketplaceNames(result.data.marketplaces.map((m) => m.name));
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadMarketplace();
  }, []); // loadMarketplace is intentionally called only on mount

  // Client-side filter (search + marketplace)
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return extensions.filter((ext) => {
      if (selectedMarketplace !== "__all__" && ext.marketplace !== selectedMarketplace) {
        return false;
      }
      if (!q) return true;
      return (
        ext.name.toLowerCase().includes(q) ||
        (ext.description ?? "").toLowerCase().includes(q) ||
        (ext.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
        (ext.author ?? "").toLowerCase().includes(q)
      );
    });
  }, [extensions, searchQuery, selectedMarketplace]);

  function handleInstallClick(ext: MarketplaceEntry & { marketplace: string }) {
    const target: MarketplaceExtensionForInstall = {
      name: ext.name,
      version: ext.version,
      repository: ext.repository,
      marketplace: ext.marketplace,
    };
    if (ext.description !== undefined) target.description = ext.description;
    if (ext.tags !== undefined) target.tags = ext.tags;
    if (ext.author !== undefined) target.author = ext.author;
    if (ext.permissions !== undefined) target.permissions = ext.permissions;
    if (ext.settings !== undefined) target.settings = ext.settings;
    setInstallTarget(target);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Fetching marketplace...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center space-y-3">
        <AlertCircle className="h-8 w-8 text-destructive mx-auto" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">Failed to load marketplace</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
        <button
          onClick={() => void loadMarketplace()}
          className="flex items-center gap-1.5 mx-auto rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search + filter bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, tag, description..."
            aria-label="Search marketplace"
            className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {marketplaceNames.length > 1 && (
          <div className="relative">
            <select
              value={selectedMarketplace}
              onChange={(e) => setSelectedMarketplace(e.target.value)}
              aria-label="Filter by marketplace"
              className={cn(
                "rounded-md border border-input bg-background pl-3 pr-7 py-2 text-sm appearance-none",
                "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <option value="__all__">All marketplaces</option>
              {marketplaceNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <ChevronDown
              className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
          </div>
        )}
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {searchQuery ? `No extensions match "${searchQuery}"` : "No extensions available"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((ext) => (
            <MarketplaceExtensionCard
              key={`${ext.marketplace}-${ext.name}`}
              extension={{ ...ext, installed: installedNames.has(ext.name) }}
              onInstall={() => handleInstallClick(ext)}
            />
          ))}
        </div>
      )}

      {/* Install dialog */}
      {installTarget && (
        <InstallDialog
          projectId={projectId}
          extension={installTarget}
          onClose={() => setInstallTarget(null)}
          onInstalled={() => {
            setInstallTarget(null);
            void fetchExtensions(projectId);
          }}
        />
      )}
    </div>
  );
}
