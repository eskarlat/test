import { useEffect, useState, useCallback } from "react";
import type { ExtensionPageProps } from "@renre-kit/extension-sdk";
import type { JiraIssue } from "../types.js";
import { searchIssues } from "../api.js";
import { IssueRow } from "../components/IssueRow.js";
import { IssueDetail } from "../components/IssueDetail.js";

type QuickFilter = "assigned" | "reported" | "recent" | "bugs";

const QUICK_FILTERS: { key: QuickFilter; label: string; jql: string }[] = [
  {
    key: "assigned",
    label: "Assigned to me",
    jql: "assignee = currentUser() ORDER BY updated DESC",
  },
  {
    key: "reported",
    label: "Reported by me",
    jql: "reporter = currentUser() ORDER BY updated DESC",
  },
  {
    key: "recent",
    label: "Recently updated",
    jql: "updated >= -7d ORDER BY updated DESC",
  },
  {
    key: "bugs",
    label: "Open bugs",
    jql: 'issuetype = Bug AND statusCategory != "Done" ORDER BY priority DESC, updated DESC',
  },
];

const PAGE_SIZE = 20;

export default function IssuesPage({ apiBaseUrl }: ExtensionPageProps) {
  const [jql, setJql] = useState("assignee = currentUser() ORDER BY updated DESC");
  const [jqlInput, setJqlInput] = useState(jql);
  const [activeFilter, setActiveFilter] = useState<QuickFilter | null>("assigned");
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const fetchIssues = useCallback(
    async (query: string, pageNum: number) => {
      setLoading(true);
      setError(null);
      try {
        const result = await searchIssues(apiBaseUrl, query, pageNum * PAGE_SIZE, PAGE_SIZE);
        setIssues(result.issues);
        setTotal(result.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setIssues([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl],
  );

  useEffect(() => {
    void fetchIssues(jql, page);
  }, [jql, page, fetchIssues]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveFilter(null);
    setPage(0);
    setJql(jqlInput);
  };

  const handleQuickFilter = (filter: QuickFilter) => {
    const f = QUICK_FILTERS.find((qf) => qf.key === filter);
    if (!f) return;
    setActiveFilter(filter);
    setJql(f.jql);
    setJqlInput(f.jql);
    setPage(0);
  };

  // Detail view
  if (selectedKey) {
    return (
      <IssueDetail
        apiBaseUrl={apiBaseUrl}
        issueKey={selectedKey}
        onBack={() => setSelectedKey(null)}
      />
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border">
        <h1 className="text-lg font-semibold mb-4">Jira Issues</h1>

        {/* JQL search */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-3">
          <input
            type="text"
            value={jqlInput}
            onChange={(e) => setJqlInput(e.target.value)}
            placeholder="Enter JQL query..."
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
          />
          <button
            type="submit"
            className="px-4 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Search
          </button>
        </form>

        {/* Quick filters */}
        <div className="flex gap-2 flex-wrap">
          {QUICK_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => handleQuickFilter(f.key)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                activeFilter === f.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-muted animate-pulse rounded" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6">
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
              {error}
            </div>
          </div>
        ) : issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mb-3 opacity-40"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <p className="text-sm">No issues found</p>
            <p className="text-xs mt-1">Try adjusting your JQL query</p>
          </div>
        ) : (
          <>
            {/* Results header */}
            <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border bg-muted/30">
              {total} issue{total !== 1 ? "s" : ""} found
              {totalPages > 1 && ` — page ${page + 1} of ${totalPages}`}
            </div>

            {/* Issue list */}
            <div>
              {issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} onClick={setSelectedKey} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 py-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 text-xs rounded-md border border-border bg-background hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <span className="text-xs text-muted-foreground">
                  {page + 1} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 text-xs rounded-md border border-border bg-background hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
