import { Search, X } from "lucide-react";
import type { LogEntry } from "../../api/hooks";

type LogLevel = LogEntry["level"];

const ALL_LEVELS: LogLevel[] = ["info", "warn", "error", "debug"];

const levelLabels: Record<LogLevel, string> = {
  info: "Info",
  warn: "Warn",
  error: "Error",
  debug: "Debug",
};

export interface LogFilters {
  levels: Set<LogLevel>;
  searchText: string;
  source: string;
}

interface LogFilterProps {
  filters: LogFilters;
  availableSources: string[];
  onChange: (filters: LogFilters) => void;
}

export function LogFilter({ filters, availableSources, onChange }: LogFilterProps) {
  function toggleLevel(level: LogLevel) {
    const next = new Set(filters.levels);
    if (next.has(level)) {
      next.delete(level);
      // Must keep at least one
      if (next.size === 0) return;
    } else {
      next.add(level);
    }
    onChange({ ...filters, levels: next });
  }

  function setSearch(text: string) {
    onChange({ ...filters, searchText: text });
  }

  function setSource(source: string) {
    onChange({ ...filters, source });
  }

  function clearSearch() {
    onChange({ ...filters, searchText: "" });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Level toggles */}
      <div className="flex items-center gap-1" role="group" aria-label="Filter by level">
        {ALL_LEVELS.map((level) => (
          <button
            key={level}
            onClick={() => toggleLevel(level)}
            className={[
              "text-xs px-2 py-1 rounded border transition-colors",
              filters.levels.has(level)
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:text-foreground",
            ].join(" ")}
            aria-pressed={filters.levels.has(level)}
          >
            {levelLabels[level]}
          </button>
        ))}
      </div>

      {/* Source filter */}
      {availableSources.length > 0 && (
        <select
          value={filters.source}
          onChange={(e) => setSource(e.target.value)}
          className="text-xs rounded-md border border-input bg-background px-2 py-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          {availableSources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}

      {/* Search box */}
      <div className="relative flex items-center flex-1 min-w-40">
        <Search className="absolute left-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <input
          type="text"
          value={filters.searchText}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search messages…"
          className="w-full rounded-md border border-input bg-background pl-7 pr-7 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Search log messages"
        />
        {filters.searchText && (
          <button
            onClick={clearSearch}
            className="absolute right-2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

export function applyLogFilters(entries: LogEntry[], filters: LogFilters): LogEntry[] {
  return entries.filter((entry) => {
    if (!filters.levels.has(entry.level)) return false;
    if (filters.source && entry.source !== filters.source) return false;
    if (
      filters.searchText &&
      !entry.message.toLowerCase().includes(filters.searchText.toLowerCase()) &&
      !entry.source.toLowerCase().includes(filters.searchText.toLowerCase())
    ) {
      return false;
    }
    return true;
  });
}
