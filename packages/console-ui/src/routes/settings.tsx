import { useState, useEffect, useCallback } from "react";
import { Settings, AlertCircle, RefreshCw } from "lucide-react";
import { Skeleton } from "../components/ui/Skeleton";
import { apiGet } from "../api/client";

interface HealthData {
  status: string;
  port: number;
  version: string;
  sdkVersion: string;
  uptime: number;
  pid?: number;
  memoryUsage?: { heapUsed: number; heapTotal: number; rss: number };
}

interface MarketplaceEntry {
  name: string;
  url: string;
}

interface WorkerConfig {
  logLevel?: string;
  marketplaces?: MarketplaceEntry[];
  backup?: {
    intervalHours?: number;
    maxCount?: number;
    maxAgeDays?: number;
  };
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-mono text-foreground">{value}</span>
    </div>
  );
}

function ServerInfoContent({ health }: { health: HealthData | null }) {
  const globalPath =
    typeof window !== "undefined"
      ? ((window as Window & { __RENRE_KIT_DATA_DIR__?: string }).__RENRE_KIT_DATA_DIR__ ??
        "~/.renre-kit")
      : "~/.renre-kit";

  if (!health) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <p className="text-sm text-muted-foreground">Server info unavailable.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card divide-y divide-border">
      <InfoRow label="Status" value={health.status} />
      <InfoRow label="Port" value={String(health.port)} />
      <InfoRow label="Version" value={health.version ?? "—"} />
      <InfoRow label="SDK Version" value={health.sdkVersion ?? "—"} />
      <InfoRow label="PID" value={health.pid ? String(health.pid) : "—"} />
      <InfoRow label="Uptime" value={formatUptime(Math.round(health.uptime))} />
      {health.memoryUsage && (
        <InfoRow label="Memory" value={formatBytes(health.memoryUsage.heapUsed)} />
      )}
      <InfoRow label="Data Directory" value={globalPath} />
    </div>
  );
}

function MarketplaceList({ marketplaces }: { marketplaces: MarketplaceEntry[] | undefined }) {
  if (!marketplaces || marketplaces.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4">
        <p className="text-sm text-muted-foreground">
          No marketplaces registered. Add them to{" "}
          <code className="font-mono bg-muted px-1 rounded">~/.renre-kit/config.json</code>:
        </p>
        <pre className="mt-2 text-xs font-mono bg-muted rounded p-3 overflow-x-auto text-foreground">
          {`{\n  "marketplaces": [\n    { "name": "My Marketplace", "url": "https://..." }\n  ]\n}`}
        </pre>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card divide-y divide-border">
      {marketplaces.map((mp) => (
        <div key={mp.url} className="flex items-center justify-between px-4 py-3 gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{mp.name}</p>
            <p className="text-xs text-muted-foreground font-mono truncate">{mp.url}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const [config, setConfig] = useState<WorkerConfig>({});
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [configResult, healthResult] = await Promise.all([
      apiGet<WorkerConfig>("/api/config"),
      apiGet<HealthData>("/health"),
    ]);
    if (configResult.data) setConfig(configResult.data);
    if (healthResult.data) setHealth(healthResult.data);
    if (!configResult.data && !healthResult.data) {
      setError(configResult.error ?? healthResult.error ?? "Failed to load settings");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Settings className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Worker service configuration and registered marketplaces.
        </p>
      </div>

      {error && !loading && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <button
            onClick={() => void loadData()}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {/* Server Info */}
      <section aria-labelledby="server-info-heading">
        <h2
          id="server-info-heading"
          className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"
        >
          <Settings className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Server Info
        </h2>
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <ServerInfoContent health={health} />
        )}
      </section>

      {/* Global Config (read-only for v1) */}
      <section aria-labelledby="config-heading">
        <h2 id="config-heading" className="text-sm font-semibold text-foreground mb-3">
          Configuration
        </h2>
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            <InfoRow label="Log Level" value={config.logLevel ?? "info"} />
            {config.backup?.intervalHours !== undefined && (
              <InfoRow label="Backup Interval" value={`${config.backup.intervalHours}h`} />
            )}
            {config.backup?.maxCount !== undefined && (
              <InfoRow label="Max Backups" value={String(config.backup.maxCount)} />
            )}
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Configuration is read-only in this version. Edit{" "}
          <code className="font-mono bg-muted px-1 rounded">~/.renre-kit/config.json</code>{" "}
          directly to make changes.
        </p>
      </section>

      {/* Registered Marketplaces */}
      <section aria-labelledby="marketplaces-heading">
        <h2 id="marketplaces-heading" className="text-sm font-semibold text-foreground mb-3">
          Registered Marketplaces
        </h2>
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <MarketplaceList marketplaces={config.marketplaces} />
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Add or remove marketplaces via{" "}
          <code className="font-mono bg-muted px-1 rounded">renre-kit marketplace add/remove</code>{" "}
          CLI commands.
        </p>
      </section>
    </div>
  );
}
