import { useState, useCallback, useMemo } from "react";
import { ScrollText, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import { useParams } from "react-router";
import { LogViewer } from "../components/logs/LogViewer";
import { LogFilter, applyLogFilters, type LogFilters } from "../components/logs/LogFilter";
import { useLogs } from "../api/hooks";

const DEFAULT_FILTERS: LogFilters = {
  levels: new Set(["info", "warn", "error", "debug"]),
  searchText: "",
  source: "",
};

export default function LogsPage() {
  const { projectId } = useParams<{ projectId?: string }>();
  const [filters, setFilters] = useState<LogFilters>(DEFAULT_FILTERS);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const { data: logs, loading, error, reload } = useLogs(projectId ?? null, 200);

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    return applyLogFilters(logs, filters);
  }, [logs, filters]);

  const availableSources = useMemo(() => {
    if (!logs) return [];
    const sources = new Set(logs.map((l) => l.source));
    return Array.from(sources).sort();
  }, [logs]);

  const handleToggleExpand = useCallback((index: number) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ScrollText className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-foreground">Logs</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {projectId ? `Logs for project ${projectId}` : "Worker service and extension logs."}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-primary"
            />
            Auto-scroll
          </label>
          <button
            onClick={reload}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Refresh logs"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      {!loading && !error && logs && logs.length > 0 && (
        <LogFilter
          filters={filters}
          availableSources={availableSources}
          onChange={setFilters}
        />
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <button
            onClick={reload}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading logs...
        </div>
      )}

      {/* Log viewer */}
      {!loading && !error && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">
            {filteredLogs.length} of {logs?.length ?? 0} entries
          </p>
          <LogViewer
            logs={filteredLogs}
            autoScroll={autoScroll}
            expandedIndex={expandedIndex}
            onToggleExpand={handleToggleExpand}
          />
        </div>
      )}
    </div>
  );
}
