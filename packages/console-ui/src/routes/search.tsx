import { useEffect, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router";
import { Search } from "lucide-react";
import { useSearchStore, type SearchResult } from "../stores/search-store";
import { PageHeader } from "../components/intelligence/shared/PageHeader";
import { EmptyState } from "../components/intelligence/shared/EmptyState";
import { SearchHighlight } from "../components/intelligence/shared/SearchHighlight";
import { TimeAgo } from "../components/intelligence/shared/TimeAgo";
import { cn } from "../lib/utils";

const TABLE_LABELS: Record<string, string> = {
  sessions: "Sessions",
  observations: "Observations",
  prompts: "Prompts",
  errors: "Error Patterns",
};

const TABLE_ROUTES: Record<string, (projectId: string, id: string) => string> = {
  sessions: (pid, id) => `/${pid}/sessions/${id}`,
  observations: (pid) => `/${pid}/observations`,
  prompts: (pid) => `/${pid}/prompts`,
  errors: (pid) => `/${pid}/errors`,
};

const ALL_TABLES = ["sessions", "observations", "prompts", "errors"];

interface SearchResultsProps {
  loading: boolean;
  error: string | null;
  query: string;
  filteredResults: SearchResult[];
  grouped: Record<string, SearchResult[]>;
  projectId: string;
  navigate: ReturnType<typeof useNavigate>;
}

function SearchResults({
  loading,
  error,
  query,
  filteredResults,
  grouped,
  projectId,
  navigate,
}: SearchResultsProps) {
  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Searching...</div>;
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!query.trim()) {
    return (
      <EmptyState
        title="Start searching"
        description="Type a query above to search across all intelligence data."
        icon={<Search className="h-8 w-8" />}
      />
    );
  }
  if (filteredResults.length === 0) {
    return (
      <EmptyState
        title="No results"
        description={`Nothing matched "${query}". Try different keywords.`}
      />
    );
  }
  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([table, items]) => (
        <div key={table}>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {TABLE_LABELS[table] ?? table} ({items.length})
          </h3>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {items.map((result) => {
              const routeFn = TABLE_ROUTES[table];
              const href = routeFn ? routeFn(projectId, result.id) : undefined;
              return (
                <div
                  key={result.id}
                  className={cn(
                    "px-4 py-3",
                    href && "cursor-pointer hover:bg-accent/40 transition-colors"
                  )}
                  onClick={() => {
                    if (href) void navigate(href);
                  }}
                >
                  <p className="text-sm text-foreground">
                    <SearchHighlight text={result.preview} query={query} />
                  </p>
                  {result.createdAt && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <TimeAgo timestamp={result.createdAt} />
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SearchPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { query, results, loading, error, activeFilters, search, setQuery, toggleFilter } =
    useSearchStore();

  const initialQ = searchParams.get("q") ?? "";

  const runSearch = useCallback(
    (q: string) => {
      if (!projectId || !q.trim()) return;
      search(projectId, q).catch(() => {});
    },
    [projectId, search]
  );

  useEffect(() => {
    if (initialQ) {
      setQuery(initialQ);
      runSearch(initialQ);
    }
  }, [initialQ, runSearch, setQuery]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    void navigate(`/${projectId}/search?q=${encodeURIComponent(query)}`);
    runSearch(query);
  }

  if (!projectId) return null;

  const filteredResults =
    activeFilters.length === 0
      ? results
      : results.filter((r) => activeFilters.includes(r.table));

  const grouped = ALL_TABLES.reduce<Record<string, typeof results>>((acc, table) => {
    const items = filteredResults.filter((r) => r.table === table);
    if (items.length) acc[table] = items;
    return acc;
  }, {});

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Search"
        description="Full-text search across sessions, observations, prompts, and errors"
        breadcrumbs={[{ label: "Dashboard", to: `/${projectId}` }, { label: "Search" }]}
      />

      {/* Search input */}
      <form onSubmit={handleSearchSubmit} className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search everything..."
            className="w-full pl-10 pr-4 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </form>

      {/* Filter checkboxes */}
      <div className="flex flex-wrap gap-3 mb-6">
        {ALL_TABLES.map((table) => (
          <label
            key={table}
            className={cn(
              "flex items-center gap-1.5 text-sm cursor-pointer px-3 py-1 rounded-full border transition-colors",
              activeFilters.includes(table)
                ? "border-ring bg-accent text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <input
              type="checkbox"
              checked={activeFilters.includes(table)}
              onChange={() => toggleFilter(table)}
              className="sr-only"
            />
            {TABLE_LABELS[table] ?? table}
          </label>
        ))}
      </div>

      {/* Results */}
      <SearchResults
        loading={loading}
        error={error}
        query={query}
        filteredResults={filteredResults}
        grouped={grouped}
        projectId={projectId}
        navigate={navigate}
      />
    </div>
  );
}
