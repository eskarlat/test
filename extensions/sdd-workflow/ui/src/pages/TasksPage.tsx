import { useEffect, useState, useMemo, useCallback } from "react";
import type { ExtensionPageProps } from "@renre-kit/extension-sdk";
import type { TaskInfo, TimeGroup } from "../types.js";
import { fetchTasks } from "../api.js";

function getTimeGroup(dateStr: string): TimeGroup {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 1 && date.getDate() === now.getDate()) return "today";
  if (diffDays < 7) return "this-week";
  if (diffDays < 30) return "this-month";
  return "older";
}

const GROUP_LABELS: Record<TimeGroup, string> = {
  today: "Today",
  "this-week": "This Week",
  "this-month": "This Month",
  older: "Older",
};

const GROUP_ORDER: TimeGroup[] = ["today", "this-week", "this-month", "older"];

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {completed}/{total}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors =
    status === "Completed"
      ? "bg-green-500/10 text-green-600 dark:text-green-400"
      : status === "In Progress"
        ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${colors}`}>
      {status}
    </span>
  );
}

export default function TasksPage({ projectId, extensionName, apiBaseUrl }: ExtensionPageProps) {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchTasks(apiBaseUrl)
      .then((r) => setTasks(r.tasks))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [apiBaseUrl]);

  const filtered = useMemo(() => {
    if (!search.trim()) return tasks;
    const q = search.toLowerCase();
    return tasks.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.phases.some((p) => p.title.toLowerCase().includes(q)),
    );
  }, [tasks, search]);

  const grouped = useMemo(() => {
    const groups: Record<TimeGroup, TaskInfo[]> = {
      today: [],
      "this-week": [],
      "this-month": [],
      older: [],
    };
    for (const task of filtered) {
      groups[getTimeGroup(task.lastModified)].push(task);
    }
    return groups;
  }, [filtered]);

  const navigateToTask = useCallback(
    (name: string) => {
      // Navigate to task-detail page via URL hash (extension routing)
      window.location.hash = `#/${projectId}/${extensionName}/task-detail?task=${encodeURIComponent(name)}`;
    },
    [projectId, extensionName],
  );

  if (loading) {
    return (
      <div className="h-full flex flex-col p-6 gap-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-10 w-full bg-muted animate-pulse rounded" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive font-medium">Failed to load tasks</p>
          <p className="text-sm text-muted-foreground mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h1 className="text-lg font-semibold">Tasks</h1>
        <span className="text-sm text-muted-foreground">{tasks.length} total</span>
      </div>

      {/* Search */}
      <div className="px-6 py-3 border-b border-border">
        <input
          type="text"
          placeholder="Search tasks and phases..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {search ? "No tasks match your search" : "No tasks yet. Run /plan to create one."}
          </div>
        ) : (
          GROUP_ORDER.map((group) => {
            const items = grouped[group];
            if (items.length === 0) return null;
            return (
              <div key={group} className="mb-6">
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  {GROUP_LABELS[group]}
                </h2>
                <div className="flex flex-col gap-2">
                  {items.map((task) => {
                    const completed = task.phases.filter((p) => p.status === "Completed").length;
                    return (
                      <button
                        key={task.name}
                        onClick={() => navigateToTask(task.name)}
                        className="w-full text-left p-4 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <span className="font-medium text-sm">{task.name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(task.lastModified).toLocaleDateString()}
                          </span>
                        </div>
                        <ProgressBar completed={completed} total={task.phases.length} />
                        <div className="flex flex-wrap gap-1 mt-2">
                          {task.phases.map((p) => (
                            <StatusBadge key={p.number} status={p.status} />
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
