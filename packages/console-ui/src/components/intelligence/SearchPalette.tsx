import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { Search, X } from "lucide-react";
import { apiGet } from "../../api/client";
import { cn } from "../../lib/utils";

interface SearchResult {
  table: string;
  id: string;
  projectId: string;
  preview: string;
  createdAt?: string;
}

interface SearchPaletteProps {
  projectId: string | null;
}

const TABLE_LABELS: Record<string, string> = {
  sessions: "Sessions",
  observations: "Observations",
  prompts: "Prompts",
  errors: "Errors",
};

const TABLE_ROUTES: Record<string, (projectId: string, id: string) => string> = {
  sessions: (pid, id) => `/${pid}/sessions/${id}`,
  observations: (pid) => `/${pid}/observations`,
  prompts: (pid) => `/${pid}/prompts`,
  errors: (pid) => `/${pid}/errors`,
};

const MAX_PER_CATEGORY = 3;

export function SearchPalette({ projectId }: SearchPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keyboard shortcut to open
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  // Debounced search
  const runSearch = useCallback(
    (q: string) => {
      if (!q.trim() || !projectId) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      apiGet<SearchResult[]>(
        `/api/${projectId}/search?q=${encodeURIComponent(q)}`
      ).then((result) => {
        if (result.data !== null) {
          setResults(result.data);
        }
        setLoading(false);
      }).catch(() => {
        setLoading(false);
      });
    },
    [projectId]
  );

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setQuery(value);
    setSelectedIndex(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), 300);
  }

  // Group results — max 3 per category
  const grouped: Record<string, SearchResult[]> = {};
  for (const result of results) {
    if (!grouped[result.table]) grouped[result.table] = [];
    if (grouped[result.table]!.length < MAX_PER_CATEGORY) {
      grouped[result.table]!.push(result);
    }
  }

  const flatResults = Object.values(grouped).flat();

  // Arrow key navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const result = flatResults[selectedIndex];
      if (result && projectId) {
        navigateToResult(result);
      } else if (query.trim() && projectId) {
        void navigate(`/${projectId}/search?q=${encodeURIComponent(query)}`);
        setOpen(false);
      }
    }
  }

  function navigateToResult(result: SearchResult) {
    if (!projectId) return;
    const routeFn = TABLE_ROUTES[result.table];
    const path = routeFn ? routeFn(projectId, result.id) : `/${projectId}/search`;
    void navigate(path);
    setOpen(false);
  }

  if (!projectId) return null;

  let flatIndex = 0;

  return (
    <>
      {/* Toolbar button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
        aria-label="Search (Cmd+K)"
        title="Search (Cmd+K)"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </button>

      {/* Palette overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Search palette"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-xl overflow-hidden">
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Search sessions, observations, prompts..."
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              {loading && (
                <span className="text-xs text-muted-foreground flex-shrink-0">Searching...</span>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-shrink-0 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Results */}
            {Object.entries(grouped).length > 0 && (
              <div className="max-h-80 overflow-y-auto">
                {Object.entries(grouped).map(([table, items]) => (
                  <div key={table}>
                    <div className="px-4 py-1.5 bg-muted/40 border-b border-border">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {TABLE_LABELS[table] ?? table}
                      </span>
                    </div>
                    {items.map((result) => {
                      const idx = flatIndex++;
                      const isSelected = idx === selectedIndex;
                      return (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => navigateToResult(result)}
                          className={cn(
                            "w-full px-4 py-2.5 text-left transition-colors border-b border-border last:border-0",
                            isSelected ? "bg-accent" : "hover:bg-accent/50"
                          )}
                        >
                          <p className="text-sm text-foreground truncate">{result.preview}</p>
                        </button>
                      );
                    })}
                    {results.filter((r) => r.table === table).length > MAX_PER_CATEGORY && (
                      <button
                        type="button"
                        onClick={() => {
                          void navigate(`/${projectId}/search?q=${encodeURIComponent(query)}`);
                          setOpen(false);
                        }}
                        className="w-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
                      >
                        View all {TABLE_LABELS[table] ?? table} results →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Footer hint */}
            <div className="px-4 py-2 border-t border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {query.trim() && !loading && results.length === 0 && "No results found"}
                {!query.trim() && "Start typing to search"}
              </span>
              {query.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    void navigate(`/${projectId}/search?q=${encodeURIComponent(query)}`);
                    setOpen(false);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  View all results →
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
