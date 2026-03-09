import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { usePromptStore, type Prompt } from "../stores/prompt-store";
import { PageHeader } from "../components/intelligence/shared/PageHeader";
import { EmptyState } from "../components/intelligence/shared/EmptyState";
import { StatsCard } from "../components/intelligence/shared/StatsCard";
import { BadgeIntent, BadgeAgent } from "../components/intelligence/shared/Badges";
import { ContributionCalendar } from "../components/intelligence/shared/ContributionCalendar";
import { TimeAgo } from "../components/intelligence/shared/TimeAgo";

interface DeleteConfirmProps {
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirm({ onConfirm, onCancel }: DeleteConfirmProps) {
  return (
    <span className="flex items-center gap-1 ml-2">
      <span className="text-xs text-muted-foreground">Confirm?</span>
      <button
        type="button"
        onClick={onConfirm}
        className="text-xs text-red-500 hover:text-red-600 font-medium"
      >
        Delete
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </span>
  );
}

interface PromptListContentProps {
  loading: boolean;
  error: string | null;
  filtered: Prompt[];
  projectId: string;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  confirmDeleteId: string | null;
  setConfirmDeleteId: (id: string | null) => void;
  deletePrompt: (projectId: string, id: string) => Promise<void>;
}

function PromptListContent({
  loading,
  error,
  filtered,
  projectId,
  expandedId,
  setExpandedId,
  confirmDeleteId,
  setConfirmDeleteId,
  deletePrompt,
}: PromptListContentProps) {
  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading prompts...</div>;
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (filtered.length === 0) {
    return (
      <EmptyState
        title="No prompts found"
        description="Prompts are recorded from agent sessions."
      />
    );
  }
  return (
    <div className="rounded-lg border border-border bg-card divide-y divide-border">
      {filtered.map((prompt) => (
        <div key={prompt.id} className="px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <BadgeAgent agent={prompt.agent} />
                <BadgeIntent intent={prompt.intent} />
                <span className="text-xs text-muted-foreground ml-auto">
                  <TimeAgo timestamp={prompt.createdAt} />
                </span>
                <span className="text-xs text-muted-foreground">
                  {prompt.tokenCount} tokens
                </span>
              </div>
              <p className="text-sm text-foreground truncate">
                {prompt.promptPreview.slice(0, 100)}
                {prompt.promptPreview.length > 100 && "…"}
              </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === prompt.id ? null : prompt.id)}
                className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                title={expandedId === prompt.id ? "Collapse" : "Expand"}
              >
                {expandedId === prompt.id ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
              {confirmDeleteId === prompt.id ? (
                <DeleteConfirm
                  onConfirm={() => {
                    deletePrompt(projectId, prompt.id).catch(() => {});
                    setConfirmDeleteId(null);
                  }}
                  onCancel={() => setConfirmDeleteId(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(prompt.id)}
                  className="p-1 rounded text-muted-foreground hover:text-red-500 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          {expandedId === prompt.id && (
            <div className="mt-2 bg-muted rounded-md p-3">
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {prompt.promptPreview}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function PromptsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { prompts, stats, loading, error, filter, fetchPrompts, fetchStats, deletePrompt, setFilter } =
    usePromptStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    fetchPrompts(projectId).catch(() => {});
    fetchStats(projectId).catch(() => {});
  }, [projectId, fetchPrompts, fetchStats]);

  if (!projectId) return null;

  const filtered = prompts.filter((p) => {
    if (filter.intent && p.intent !== filter.intent) return false;
    if (filter.agent && !(p.agent ?? "").toLowerCase().includes(filter.agent.toLowerCase())) return false;
    if (filter.dateFrom && new Date(p.createdAt) < new Date(filter.dateFrom)) return false;
    if (filter.dateTo && new Date(p.createdAt) > new Date(filter.dateTo)) return false;
    if (
      filter.search &&
      !(p.promptPreview ?? "").toLowerCase().includes(filter.search.toLowerCase())
    )
      return false;
    return true;
  });

  const dailyData = (() => {
    const counts: Record<string, number> = {};
    for (const p of prompts) {
      const date = p.createdAt.slice(0, 10);
      counts[date] = (counts[date] ?? 0) + 1;
    }
    return Object.entries(counts).map(([date, count]) => ({ date, count }));
  })();

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Prompt Journal"
        description="Recorded prompts from agent sessions"
        breadcrumbs={[{ label: "Dashboard", to: `/${projectId}` }, { label: "Prompts" }]}
      />

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatsCard label="Total Prompts" value={stats.total} />
          <StatsCard label="Intents" value={Object.keys(stats.byIntent).length} />
          <StatsCard label="Agents" value={Object.keys(stats.byAgent).length} />
          <StatsCard
            label="Avg Tokens"
            value={
              prompts.length
                ? Math.round(prompts.reduce((s, p) => s + p.tokenCount, 0) / prompts.length)
                : 0
            }
          />
        </div>
      )}

      {/* Contribution calendar */}
      {prompts.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 mb-6">
          <p className="text-xs font-medium text-muted-foreground mb-3">By Agent</p>
          <ContributionCalendar data={dailyData} label="prompts" />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search prompts..."
          value={filter.search ?? ""}
          onChange={(e) => setFilter({ search: e.target.value || undefined })}
          className="flex-1 min-w-40 px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          type="text"
          placeholder="Filter agent..."
          value={filter.agent ?? ""}
          onChange={(e) => setFilter({ agent: e.target.value || undefined })}
          className="px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {stats && Object.keys(stats.byIntent).length > 0 && (
          <select
            value={filter.intent ?? ""}
            onChange={(e) => setFilter({ intent: e.target.value || undefined })}
            className="px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All intents</option>
            {Object.keys(stats.byIntent).map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        )}
        <input
          type="date"
          value={filter.dateFrom ?? ""}
          onChange={(e) => setFilter({ dateFrom: e.target.value || undefined })}
          className="px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          type="date"
          value={filter.dateTo ?? ""}
          onChange={(e) => setFilter({ dateTo: e.target.value || undefined })}
          className="px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <PromptListContent
        loading={loading}
        error={error}
        filtered={filtered}
        projectId={projectId}
        expandedId={expandedId}
        setExpandedId={setExpandedId}
        confirmDeleteId={confirmDeleteId}
        setConfirmDeleteId={setConfirmDeleteId}
        deletePrompt={deletePrompt}
      />

      <p className="mt-2 text-xs text-muted-foreground">
        {filtered.length} prompt{filtered.length !== 1 ? "s" : ""}
        {prompts.length !== filtered.length ? ` (${prompts.length} total)` : ""}
      </p>
    </div>
  );
}
