import { useEffect, useState } from "react";
import { useParams } from "react-router";
import {
  MessageSquare,
  Wrench,
  AlertCircle,
  GitBranch,
  Zap,
  Bookmark,
} from "lucide-react";
import { useSessionStore, type TimelineEvent } from "../../stores/session-store";
import { PageHeader } from "../../components/intelligence/shared/PageHeader";
import { StatsCard } from "../../components/intelligence/shared/StatsCard";
import { EmptyState } from "../../components/intelligence/shared/EmptyState";
import { BadgeAgent, BadgeStatus } from "../../components/intelligence/shared/Badges";
import { cn } from "../../lib/utils";

type EventFilter = "all" | "prompt" | "tool" | "error" | "subagent" | "hook";

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

function getContextBarColor(pct: number): string {
  if (pct > 80) return "bg-red-500";
  if (pct > 60) return "bg-yellow-500";
  return "bg-primary";
}

function EventTypeIcon({ type }: { type: TimelineEvent["eventType"] }) {
  const cls = "h-4 w-4 flex-shrink-0";
  if (type === "prompt") return <MessageSquare className={cn(cls, "text-blue-500")} />;
  if (type === "tool") return <Wrench className={cn(cls, "text-purple-500")} />;
  if (type === "error") return <AlertCircle className={cn(cls, "text-red-500")} />;
  if (type === "subagent") return <GitBranch className={cn(cls, "text-green-500")} />;
  if (type === "hook") return <Zap className={cn(cls, "text-yellow-500")} />;
  if (type === "checkpoint") return <Bookmark className={cn(cls, "text-cyan-500")} />;
  return null;
}

function HookSummaryLine({ data }: { data: Record<string, unknown> }) {
  const feature = typeof data["feature"] === "string" ? data["feature"] : "";
  const success = data["success"] === true;
  const response = data["response"] as Record<string, unknown> | null | undefined;

  // Surface the most important response key inline
  let responseHint: string | null = null;
  if (response) {
    if (typeof response["permissionDecision"] === "string") {
      responseHint = `→ ${response["permissionDecision"]}`;
    } else if (typeof response["additionalContext"] === "string" && response["additionalContext"]) {
      responseHint = `→ injected context`;
    } else if (typeof response["systemMessage"] === "string" && response["systemMessage"]) {
      responseHint = `→ checkpoint injected`;
    } else if (typeof response["guidelines"] === "string" && response["guidelines"]) {
      responseHint = `→ guidelines sent`;
    }
  }

  return (
    <span className="text-xs text-muted-foreground truncate">
      {feature}
      {!success && <span className="text-red-500 ml-1">failed</span>}
      {responseHint && <span className="ml-1 text-emerald-600 dark:text-emerald-400">{responseHint}</span>}
    </span>
  );
}

function TimelineItem({ event }: { event: TimelineEvent }) {
  const [expanded, setExpanded] = useState(false);
  const isSubagent = event.eventType === "subagent" || event.parentEventId !== undefined;
  const isHook = event.eventType === "hook";
  const hookResponse = isHook
    ? (event.data["response"] as Record<string, unknown> | null | undefined)
    : null;
  // Separate input data from response for hooks so each panel is clean
  const displayData = isHook
    ? (({ response: _r, ...rest }) => rest)(event.data as Record<string, unknown> & { response?: unknown })
    : event.data;
  const hasDetail = Object.keys(displayData).length > 0 || (hookResponse && Object.keys(hookResponse).length > 0);

  return (
    <div
      className={cn(
        "flex gap-3 py-2 px-3 rounded-md hover:bg-accent/30 transition-colors",
        isSubagent && event.parentEventId && "ml-6 border-l-2 border-green-200 dark:border-green-800 pl-4"
      )}
    >
      <div className="flex-shrink-0 mt-0.5">
        <EventTypeIcon type={event.eventType} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {new Date(event.timestamp).toLocaleTimeString()}
          </span>
          <span className="text-xs font-medium text-foreground capitalize">
            {event.eventType}
          </span>
          {isHook && <HookSummaryLine data={event.data} />}
          {hasDetail && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
            >
              {expanded ? "collapse" : "expand"}
            </button>
          )}
        </div>
        {expanded && (
          <div className="mt-2 space-y-2">
            <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-48 text-foreground">
              {JSON.stringify(displayData, null, 2)}
            </pre>
            {hookResponse && Object.keys(hookResponse).length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Response sent to agent:</p>
                <pre className="text-xs bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded p-2 overflow-x-auto max-h-48 text-foreground">
                  {JSON.stringify(hookResponse, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SessionTimelinePage() {
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId: string }>();
  const { activeSession, timeline, loading, error, fetchTimeline } = useSessionStore();
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");

  useEffect(() => {
    if (!projectId || !sessionId) return;
    fetchTimeline(projectId, sessionId).catch(() => {});
  }, [projectId, sessionId, fetchTimeline]);

  if (!projectId || !sessionId) return null;

  const filterTypes: EventFilter[] = ["all", "prompt", "tool", "error", "subagent", "hook"];

  const filteredEvents =
    eventFilter === "all"
      ? timeline
      : timeline.filter((e) => e.eventType === eventFilter);

  const contextPct = activeSession
    ? Math.min(
        100,
        (activeSession.promptCount / Math.max(activeSession.promptCount + 10, 1)) * 100
      )
    : 0;

  const header = (
    <PageHeader
      title="Session Timeline"
      description={activeSession?.id}
      breadcrumbs={[
        { label: "Dashboard", to: `/${projectId}` },
        { label: "Sessions", to: `/${projectId}/sessions` },
        { label: "Timeline" },
      ]}
    />
  );

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto">
        {header}
        <div className="p-6 text-sm text-muted-foreground">Loading timeline...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto">
        {header}
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col max-w-3xl mx-auto h-full">
      <div className="flex-shrink-0">
        {header}

        {/* Session summary */}
        {activeSession && (
          <div className="space-y-4 mb-6">
            <div className="flex items-center gap-3">
              <BadgeAgent agent={activeSession.agent} />
              <BadgeStatus status={activeSession.status} />
              <span className="text-sm text-muted-foreground">
                {formatDuration(activeSession.startedAt, activeSession.endedAt)}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <StatsCard label="Prompts" value={activeSession.promptCount} />
              <StatsCard label="Tool Uses" value={activeSession.toolCount} />
              <StatsCard
                label="Errors"
                value={activeSession.errorCount}
              />
            </div>

            {/* Context usage bar */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground font-medium">Context Budget</span>
                <span className="text-xs text-muted-foreground">{contextPct.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    getContextBarColor(contextPct)
                  )}
                  style={{ width: `${contextPct}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Filter pills */}
        <div className="flex flex-wrap gap-2 mb-4">
          {filterTypes.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setEventFilter(f)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize",
                eventFilter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "all"
                ? `All (${timeline.length})`
                : `${f}s (${timeline.filter((e) => e.eventType === f).length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline — fills remaining viewport height */}
      {filteredEvents.length === 0 ? (
        <EmptyState
          title="No events"
          description="No timeline events match the current filter."
        />
      ) : (
        <div className="flex-1 min-h-0 rounded-lg border border-border bg-card p-2 overflow-y-auto space-y-0.5">
          {filteredEvents.map((event) => (
            <TimelineItem key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
