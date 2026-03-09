import { useEffect } from "react";
import { useParams } from "react-router";
import { Wrench, AlertTriangle } from "lucide-react";
import { useToolAnalyticsStore } from "../stores/tool-analytics-store";
import { PageHeader } from "../components/intelligence/shared/PageHeader";
import { EmptyState } from "../components/intelligence/shared/EmptyState";
import { StatsCard } from "../components/intelligence/shared/StatsCard";
import { BarChart } from "../components/intelligence/shared/BarChart";
import { TimeAgo } from "../components/intelligence/shared/TimeAgo";

export default function ToolAnalyticsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { analytics, warnings, loading, error, fetchAnalytics, fetchWarnings } =
    useToolAnalyticsStore();

  useEffect(() => {
    if (!projectId) return;
    fetchAnalytics(projectId).catch(() => {});
    fetchWarnings(projectId).catch(() => {});
  }, [projectId, fetchAnalytics, fetchWarnings]);

  if (!projectId) return null;

  const toolBreakdownData = analytics
    ? Object.entries(analytics.byTool)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([label, value]) => ({ label, value }))
    : [];

  const hotspots = analytics?.fileHotspots ?? analytics?.mostTouchedFiles ?? [];

  const header = (
    <PageHeader
      title="Tool Analytics"
      description="Usage statistics for tools used by AI agents"
      breadcrumbs={[{ label: "Dashboard", to: `/${projectId}` }, { label: "Tool Analytics" }]}
    />
  );

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        {header}
        <div className="p-6 text-sm text-muted-foreground">Loading tool analytics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        {header}
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="max-w-4xl mx-auto">
        {header}
        <EmptyState
          title="No tool analytics"
          description="Tool usage data will appear here as agents use tools."
          icon={<Wrench className="h-8 w-8" />}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {header}
      <div className="space-y-6">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <StatsCard label="Total Tool Uses" value={analytics.totalCount} />
            <StatsCard
              label="Success Rate"
              value={`${(analytics.successRate * 100).toFixed(1)}%`}
            />
            <StatsCard label="Unique Tools" value={Object.keys(analytics.byTool).length} />
          </div>

          {/* Tool breakdown chart */}
          {toolBreakdownData.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground mb-3">
                Tool Type Breakdown (top 10)
              </p>
              <BarChart data={toolBreakdownData} height={200} />
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Warnings ({warnings.length})
              </h3>
              <div className="rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/10 divide-y divide-yellow-200 dark:divide-yellow-800">
                {warnings.map((w, i) => (
                  <div key={i} className="px-4 py-3 flex items-start gap-3">
                    <span className="text-xs bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200 px-2 py-0.5 rounded font-medium flex-shrink-0">
                      {w.type}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">{w.detail}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        session {w.sessionId} &middot;{" "}
                        <TimeAgo timestamp={w.createdAt} />
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* File hotspots */}
          {hotspots.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">
                File Hotspots
              </h3>
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground flex justify-between">
                  <span>File Path</span>
                  <span>Edit Count</span>
                </div>
                <div className="divide-y divide-border">
                  {hotspots.slice(0, 20).map((h, i) => (
                    <div key={i} className="px-4 py-2 flex items-center justify-between gap-3">
                      <code className="text-xs text-foreground font-mono truncate flex-1">
                        {h.filePath}
                      </code>
                      <span className="text-sm font-medium text-foreground tabular-nums flex-shrink-0">
                        {h.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tool list table */}
          {toolBreakdownData.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">
                Command Frequency
              </h3>
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground flex justify-between">
                  <span>Tool</span>
                  <span>Uses</span>
                </div>
                <div className="divide-y divide-border">
                  {toolBreakdownData.map(({ label, value }) => (
                    <div key={label} className="px-4 py-2 flex items-center justify-between gap-3">
                      <span className="text-sm font-mono text-foreground">{label}</span>
                      <span className="text-sm text-muted-foreground tabular-nums">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
  );
}
