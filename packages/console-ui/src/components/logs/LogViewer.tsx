import { useRef, useEffect } from "react";
import { ScrollText, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";
import type { LogEntry } from "../../api/hooks";

const levelColors: Record<string, string> = {
  info: "text-blue-600 dark:text-blue-400",
  warn: "text-yellow-600 dark:text-yellow-400",
  error: "text-red-600 dark:text-red-400",
  debug: "text-muted-foreground",
};

interface LogViewerProps {
  logs: LogEntry[];
  autoScroll: boolean;
  expandedIndex: number | null;
  onToggleExpand: (index: number) => void;
}

export function LogViewer({ logs, autoScroll, expandedIndex, onToggleExpand }: LogViewerProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  if (logs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <ScrollText className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">No logs match your filters</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Try changing the level filter or clearing the search.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-border bg-card overflow-hidden"
      role="log"
      aria-label="Log output"
      aria-live="polite"
    >
      <div className="overflow-y-auto max-h-[calc(100vh-280px)] font-mono text-xs">
        {logs.map((entry, i) => (
          <div key={i}>
            <div
              className={cn(
                "flex items-start gap-3 px-3 py-1.5 odd:bg-muted/20 hover:bg-accent/20 cursor-default",
                entry.level === "error" && "bg-red-50/50 dark:bg-red-950/20 odd:bg-red-50/50 dark:odd:bg-red-950/20 hover:bg-red-100/50 dark:hover:bg-red-900/20"
              )}
            >
              <span className="text-muted-foreground flex-shrink-0 tabular-nums whitespace-nowrap">
                {new Date(entry.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              <span
                className={cn(
                  "uppercase text-xs font-semibold flex-shrink-0 w-10",
                  levelColors[entry.level] ?? "text-foreground"
                )}
              >
                {entry.level}
              </span>
              <span className="text-muted-foreground flex-shrink-0 max-w-28 truncate">
                {entry.source}
              </span>
              <span className="text-foreground break-words min-w-0 flex-1">{entry.message}</span>
              {entry.level === "error" && (
                <button
                  onClick={() => onToggleExpand(i)}
                  className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={expandedIndex === i ? "Collapse error details" : "Expand error details"}
                  aria-expanded={expandedIndex === i}
                >
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", expandedIndex === i && "rotate-180")}
                    aria-hidden="true"
                  />
                </button>
              )}
            </div>
            {expandedIndex === i && entry.level === "error" && (
              <div className="px-3 py-2 bg-red-50/70 dark:bg-red-950/30 border-b border-border font-mono text-xs text-red-800 dark:text-red-300 whitespace-pre-wrap break-words">
                {entry.message}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
