import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import { useErrorStore, type ErrorPattern } from "../stores/error-store";
import { useObservationStore } from "../stores/observation-store";
import { PageHeader } from "../components/intelligence/shared/PageHeader";
import { EmptyState } from "../components/intelligence/shared/EmptyState";
import { BarChart } from "../components/intelligence/shared/BarChart";
import { BadgeStatus } from "../components/intelligence/shared/Badges";
import { TimeAgo } from "../components/intelligence/shared/TimeAgo";
import { cn } from "../lib/utils";

type TrendWindow = "7d" | "30d";

interface ResolveDialogProps {
  projectId: string;
  pattern: ErrorPattern;
  onClose: () => void;
}

function ResolveDialog({ projectId, pattern, onClose }: ResolveDialogProps) {
  const { updatePattern } = useErrorStore();
  const { createObservation } = useObservationStore();
  const [note, setNote] = useState("");
  const [createObs, setCreateObs] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleResolve() {
    setSaving(true);
    const updateData: Partial<ErrorPattern> = { status: "resolved" };
    if (note) updateData.resolutionNote = note;
    await updatePattern(projectId, pattern.id, updateData);
    if (createObs && note.trim()) {
      await createObservation(projectId, {
        content: note.trim(),
        category: "error",
      });
    }
    setSaving(false);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resolve-dialog-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-background shadow-xl p-6">
        <h2 id="resolve-dialog-title" className="text-base font-semibold mb-1">
          Resolve Error Pattern
        </h2>
        <p className="text-sm text-muted-foreground mb-4 truncate">
          {pattern.messageTemplate}
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Resolution Note
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="What caused this error and how was it fixed?"
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={createObs}
              onChange={(e) => setCreateObs(e.target.checked)}
              className="accent-primary"
            />
            Create observation from this note
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleResolve()}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Resolve"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PatternRowProps {
  pattern: ErrorPattern;
  projectId: string;
}

function PatternRow({ pattern, projectId }: PatternRowProps) {
  const { updatePattern } = useErrorStore();
  const [expanded, setExpanded] = useState(false);
  const [showResolve, setShowResolve] = useState(false);

  return (
    <>
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex-shrink-0 mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-mono text-foreground truncate">
              {pattern.messageTemplate}
            </p>
            <div className="flex items-center flex-wrap gap-2 mt-1">
              <BadgeStatus status={pattern.status} />
              <span className="text-xs text-muted-foreground">
                {pattern.occurrenceCount} occurrence{pattern.occurrenceCount !== 1 ? "s" : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {pattern.sessionCount} session{pattern.sessionCount !== 1 ? "s" : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                last seen <TimeAgo timestamp={pattern.lastSeenAt} />
              </span>
              {pattern.toolName && (
                <span className="text-xs bg-muted px-1 rounded font-mono">{pattern.toolName}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {pattern.status === "active" && (
              <button
                type="button"
                onClick={() => setShowResolve(true)}
                className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                Resolve
              </button>
            )}
            {pattern.status === "active" && (
              <button
                type="button"
                onClick={() =>
                  updatePattern(projectId, pattern.id, { status: "ignored" }).catch(() => {})
                }
                className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                Ignore
              </button>
            )}
            {pattern.status === "ignored" && (
              <button
                type="button"
                onClick={() =>
                  updatePattern(projectId, pattern.id, { status: "active" }).catch(() => {})
                }
                className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                Unignore
              </button>
            )}
          </div>
        </div>
        {expanded && (
          <div className="mt-2 ml-6 bg-muted/40 rounded p-3 text-xs space-y-1">
            <p className="text-muted-foreground">
              <span className="font-medium">First seen:</span>{" "}
              {new Date(pattern.firstSeenAt).toLocaleString()}
            </p>
            <p className="text-muted-foreground">
              <span className="font-medium">Last seen:</span>{" "}
              {new Date(pattern.lastSeenAt).toLocaleString()}
            </p>
            <p className="text-muted-foreground">
              <span className="font-medium">Fingerprint:</span>{" "}
              <code className="font-mono">{pattern.fingerprint}</code>
            </p>
            {pattern.resolutionNote && (
              <p className="text-muted-foreground">
                <span className="font-medium">Resolution note:</span>{" "}
                {pattern.resolutionNote}
              </p>
            )}
          </div>
        )}
      </div>
      {showResolve && (
        <ResolveDialog
          projectId={projectId}
          pattern={pattern}
          onClose={() => setShowResolve(false)}
        />
      )}
    </>
  );
}

export default function ErrorsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { patterns, trends, loading, error, fetchPatterns, fetchTrends } = useErrorStore();
  const [trendWindow, setTrendWindow] = useState<TrendWindow>("7d");
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    fetchPatterns(projectId).catch(() => {});
    fetchTrends(projectId).catch(() => {});
  }, [projectId, fetchPatterns, fetchTrends]);

  if (!projectId) return null;

  const windowDays = trendWindow === "7d" ? 7 : 30;
  const trendData = trends
    .slice(-windowDays)
    .map((t) => ({
      label: new Date(t.date).toLocaleDateString("en-US", { month: "numeric", day: "numeric" }),
      value: t.count,
    }));

  const activePatterns = patterns.filter((p) => p.status === "active");
  const resolvedPatterns = patterns.filter((p) => p.status === "resolved");
  const ignoredPatterns = patterns.filter((p) => p.status === "ignored");

  const header = (
    <PageHeader
      title="Error Patterns"
      description="Recurring errors detected across agent sessions"
      breadcrumbs={[{ label: "Dashboard", to: `/${projectId}` }, { label: "Errors" }]}
    />
  );

  const trendChart = trendData.length > 0 ? (
    <div className="rounded-lg border border-border bg-card p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-muted-foreground">Error Trend</p>
        <div className="flex gap-1">
          {(["7d", "30d"] as TrendWindow[]).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setTrendWindow(w)}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-colors",
                trendWindow === w
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {w}
            </button>
          ))}
        </div>
      </div>
      <BarChart data={trendData} height={100} color="hsl(var(--destructive))" />
    </div>
  ) : null;

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        {header}
        <div className="p-6 text-sm text-muted-foreground">Loading error patterns...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        {header}
        {trendChart}
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  if (activePatterns.length === 0 && ignoredPatterns.length === 0) {
    return (
      <div className="max-w-4xl mx-auto">
        {header}
        {trendChart}
        <EmptyState
          title="No error patterns"
          description="Error patterns will appear here when the hook system detects recurring errors."
          icon={<AlertCircle className="h-8 w-8" />}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {header}
      {trendChart}
      <div className="space-y-4">
        {/* Active patterns */}
        {(activePatterns.length > 0 || ignoredPatterns.length > 0) && (
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {[...activePatterns, ...ignoredPatterns].map((p) => (
              <PatternRow key={p.id} pattern={p} projectId={projectId} />
            ))}
          </div>
        )}

        {/* Resolved patterns */}
        {resolvedPatterns.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowResolved((v) => !v)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              {showResolved ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Resolved ({resolvedPatterns.length})
            </button>
            {showResolved && (
              <div className="rounded-lg border border-border bg-card opacity-70 divide-y divide-border">
                {resolvedPatterns.map((p) => (
                  <PatternRow key={p.id} pattern={p} projectId={projectId} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
