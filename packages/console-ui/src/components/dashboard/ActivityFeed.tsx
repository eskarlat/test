import { Activity } from "lucide-react";
import { useNotificationStore, type EventEntry } from "../../stores/notification-store";

function formatEventLabel(entry: EventEntry): string {
  const payload = entry.payload as Record<string, unknown> | null;
  const name = payload && "name" in payload ? String(payload["name"]) : null;
  return name ? `${entry.event} — ${name}` : entry.event;
}

function formatProjectId(entry: EventEntry): string | null {
  const payload = entry.payload as Record<string, unknown> | null;
  if (!payload || !("projectId" in payload)) return null;
  return String(payload["projectId"]);
}

export function ActivityFeed() {
  const recentEvents = useNotificationStore((s) => s.recentEvents);

  if (recentEvents.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <Activity className="h-6 w-6 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">No recent activity yet.</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Events will appear here as the worker sends them.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card divide-y divide-border">
      {recentEvents.slice(0, 20).map((entry, i) => {
        const projectId = formatProjectId(entry);
        return (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-2 text-xs text-muted-foreground"
          >
            <span className="text-foreground font-mono tabular-nums flex-shrink-0">
              {new Date(entry.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {projectId && (
              <span className="text-foreground font-medium flex-shrink-0 max-w-[6rem] truncate">
                {projectId}
              </span>
            )}
            <span className="truncate">{formatEventLabel(entry)}</span>
          </div>
        );
      })}
    </div>
  );
}
