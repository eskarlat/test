import { cn } from "../../lib/utils";
import { useChatStore } from "../../stores/chat-store";

function getContextColor(pct: number): string {
  if (pct >= 95) return "bg-red-500";
  if (pct >= 80) return "bg-orange-500";
  if (pct >= 60) return "bg-yellow-500";
  return "bg-green-500";
}

function getContextTextColor(pct: number): string {
  if (pct >= 95) return "text-red-500";
  if (pct >= 80) return "text-orange-500";
  if (pct >= 60) return "text-yellow-500";
  return "text-muted-foreground";
}

export function ChatContextBar() {
  const contextWindowPct = useChatStore((s) => s.contextWindowPct);
  const ttftMs = useChatStore((s) => s.ttftMs);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const selectedEffort = useChatStore((s) => s.selectedEffort);
  const models = useChatStore((s) => s.models);

  const model = models.find((m) => m.id === selectedModel);
  const modelName = model?.name ?? selectedModel;

  return (
    <div className="flex items-center gap-2 md:gap-3 px-2 md:px-4 py-1.5 border-b border-border text-xs text-muted-foreground">
      {/* Model + effort */}
      <span className="font-medium truncate">{modelName}</span>
      {model?.supportsReasoning && (
        <span className="px-1.5 py-0.5 rounded bg-muted text-[10px]">
          {selectedEffort}
        </span>
      )}

      <span className="flex-1" />

      {/* TTFT */}
      {isStreaming && ttftMs !== null && (
        <span className="tabular-nums">
          TTFT: {Math.round(ttftMs)}ms
        </span>
      )}

      {/* Context window */}
      {contextWindowPct > 0 && (
        <div className="flex items-center gap-1.5">
          <span className={cn("tabular-nums", getContextTextColor(contextWindowPct))}>
            {Math.round(contextWindowPct)}%
          </span>
          <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", getContextColor(contextWindowPct))}
              style={{ width: `${Math.min(contextWindowPct, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
