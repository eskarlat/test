import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { Users } from "lucide-react";
import { useSessionStore, type Session } from "../../stores/session-store";
import { apiGet } from "../../api/client";
import { PageHeader } from "../../components/intelligence/shared/PageHeader";
import { EmptyState } from "../../components/intelligence/shared/EmptyState";
import { BadgeStatus, BadgeAgent } from "../../components/intelligence/shared/Badges";

interface ContextUsage {
  used: number;
  budget: number;
  percentage: number;
}

function formatDuration(startedAt: string, endedAt?: string): string {
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const diffMs = end - new Date(startedAt).getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return `${diffSeconds}s`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;
  return `${hours}h ${mins}m`;
}

function ContextUsagePanel({
  loading,
  usage,
}: {
  loading: boolean;
  usage: ContextUsage | null;
}) {
  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading context usage...</p>;
  }
  if (!usage) {
    return <p className="text-xs text-muted-foreground">Context usage unavailable</p>;
  }
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground font-medium">Context Usage</p>
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${Math.min(100, usage.percentage)}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {usage.percentage.toFixed(1)}%
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {usage.used.toLocaleString()} / {usage.budget.toLocaleString()} tokens
      </p>
    </div>
  );
}

interface SessionRowProps {
  session: Session;
  projectId: string;
}

function SessionRow({ session, projectId }: SessionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const navigate = useNavigate();

  async function handleExpand() {
    if (!expanded && contextUsage === null) {
      setContextLoading(true);
      const result = await apiGet<ContextUsage>(
        `/api/${projectId}/sessions/${session.id}/context-usage`
      );
      if (result.data !== null) setContextUsage(result.data);
      setContextLoading(false);
    }
    setExpanded((v) => !v);
  }

  return (
    <div className="border-b border-border last:border-0">
      <div
        className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40 cursor-pointer transition-colors"
        onClick={() => void navigate(`/${projectId}/sessions/${session.id}`)}
      >
        <BadgeAgent agent={session.agent} />
        <span className="flex-1 min-w-0">
          <span className="text-xs text-muted-foreground font-mono truncate block">
            {session.id}
          </span>
        </span>
        <span className="text-xs text-muted-foreground hidden sm:block">
          {formatDuration(session.startedAt, session.endedAt)}
        </span>
        <BadgeStatus status={session.status} />
        <div className="flex items-center gap-3 text-xs text-muted-foreground ml-2">
          <span title="Prompts">{session.promptCount}p</span>
          <span title="Tools">{session.toolCount}t</span>
          <span title="Errors" className={session.errorCount > 0 ? "text-red-500" : ""}>
            {session.errorCount}e
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleExpand();
          }}
          className="ml-2 text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          {expanded ? "Hide" : "Context"}
        </button>
      </div>
      {expanded && (
        <div className="px-4 pb-3 bg-muted/30">
          <ContextUsagePanel loading={contextLoading} usage={contextUsage} />
        </div>
      )}
    </div>
  );
}

function SessionListContent({
  loading,
  error,
  filtered,
  projectId,
}: {
  loading: boolean;
  error: string | null;
  filtered: Session[];
  projectId: string;
}) {
  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading sessions...</div>;
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
        title="No sessions found"
        description="Sessions are recorded when an AI agent starts working in this project."
        icon={<Users className="h-8 w-8" />}
      />
    );
  }
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-2 bg-muted/50 border-b border-border flex items-center gap-3 text-xs font-medium text-muted-foreground">
        <span className="flex-shrink-0 w-24">Agent</span>
        <span className="flex-1">Session ID</span>
        <span className="hidden sm:block w-12">Duration</span>
        <span className="w-16">Status</span>
        <span className="w-20">Stats</span>
        <span className="w-12" />
      </div>
      {filtered.map((session) => (
        <SessionRow key={session.id} session={session} projectId={projectId} />
      ))}
    </div>
  );
}

export default function SessionListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { sessions, loading, error, filter, fetchSessions, setFilter } = useSessionStore();

  useEffect(() => {
    if (!projectId) return;
    fetchSessions(projectId).catch(() => {});
  }, [projectId, fetchSessions]);

  const filtered = sessions.filter((s) => {
    if (filter.agent && !s.agent.toLowerCase().includes(filter.agent.toLowerCase())) return false;
    if (filter.status && s.status !== filter.status) return false;
    if (filter.dateFrom && new Date(s.startedAt) < new Date(filter.dateFrom)) return false;
    if (filter.dateTo && new Date(s.startedAt) > new Date(filter.dateTo)) return false;
    return true;
  });

  if (!projectId) return null;

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Sessions"
        description="Agent session history and timelines"
        breadcrumbs={[{ label: "Dashboard", to: `/${projectId}` }, { label: "Sessions" }]}
      />

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Filter by agent..."
          value={filter.agent ?? ""}
          onChange={(e) => setFilter({ agent: e.target.value || undefined })}
          className="px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={filter.status ?? ""}
          onChange={(e) => setFilter({ status: e.target.value || undefined })}
          className="px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="ended">Ended</option>
        </select>
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

      <SessionListContent
        loading={loading}
        error={error}
        filtered={filtered}
        projectId={projectId}
      />

      <p className="mt-2 text-xs text-muted-foreground">
        {filtered.length} session{filtered.length !== 1 ? "s" : ""}
        {sessions.length !== filtered.length ? ` (${sessions.length} total)` : ""}
        {filtered.length > 0 && (
          <> — click a row to view timeline, click "Context" to preview context usage</>
        )}
      </p>
    </div>
  );
}
