import { useEffect, useState, useCallback } from "react";
import type { ExtensionPageProps } from "@renre-kit/extension-sdk";
import type { JiraIssue } from "../types.js";
import { searchIssues } from "../api.js";
import { IssueRow } from "../components/IssueRow.js";
import { IssueDetail } from "../components/IssueDetail.js";

type MentionTab = "assigned" | "reported" | "watching";

const TABS: { key: MentionTab; label: string; jql: string }[] = [
  {
    key: "assigned",
    label: "Assigned to me",
    jql: 'assignee = currentUser() AND statusCategory != "Done" ORDER BY updated DESC',
  },
  {
    key: "reported",
    label: "Reported by me",
    jql: "reporter = currentUser() ORDER BY updated DESC",
  },
  {
    key: "watching",
    label: "Watching",
    jql: "watcher = currentUser() ORDER BY updated DESC",
  },
];

const PAGE_SIZE = 20;

export default function MentionsPage({ apiBaseUrl }: ExtensionPageProps) {
  const [activeTab, setActiveTab] = useState<MentionTab>("assigned");
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const jql = TABS.find((t) => t.key === activeTab)!.jql;

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await searchIssues(apiBaseUrl, jql, page * PAGE_SIZE, PAGE_SIZE);
      setIssues(result.issues);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIssues([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, jql, page]);

  useEffect(() => {
    void fetchIssues();
  }, [fetchIssues]);

  const switchTab = (tab: MentionTab) => {
    setActiveTab(tab);
    setPage(0);
    setSelectedKey(null);
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
      <div className="px-6 pt-6 pb-0 border-b border-border">
        <h1 className="text-lg font-semibold mb-4">My Jira Activity</h1>

        {/* Tabs */}
        <div className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => switchTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {tab.label}
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
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <p className="text-sm">No issues found</p>
            <p className="text-xs mt-1">
              {activeTab === "assigned" && "You have no open assigned issues"}
              {activeTab === "reported" && "You haven't reported any issues"}
              {activeTab === "watching" && "You're not watching any issues"}
            </p>
          </div>
        ) : (
          <>
            <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border bg-muted/30">
              {total} issue{total !== 1 ? "s" : ""}
              {totalPages > 1 && ` — page ${page + 1} of ${totalPages}`}
            </div>

            <div>
              {issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} onClick={setSelectedKey} />
              ))}
            </div>

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
