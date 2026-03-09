import { Zap } from "lucide-react";
import { useChatStore } from "../../stores/chat-store";
import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/Skeleton";

export function ChatModelSelector() {
  const models = useChatStore((s) => s.models);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const selectedEffort = useChatStore((s) => s.selectedEffort);
  const autopilot = useChatStore((s) => s.autopilot);
  const setModel = useChatStore((s) => s.setModel);
  const setEffort = useChatStore((s) => s.setEffort);
  const setAutopilot = useChatStore((s) => s.setAutopilot);

  if (models.length === 0) {
    return <Skeleton className="h-8 w-48" />;
  }

  const current = models.find((m) => m.id === selectedModel);
  const showEffort = current?.supportsReasoning;
  const effortOptions = current?.supportedReasoningEfforts ?? ["low", "medium", "high"];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={selectedModel}
        onChange={(e) => setModel(e.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring max-w-[140px] md:max-w-none"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>

      {showEffort && (
        <select
          value={selectedEffort}
          onChange={(e) => setEffort(e.target.value as "low" | "medium" | "high" | "xhigh")}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {effortOptions.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      )}

      <button
        onClick={() => setAutopilot(!autopilot)}
        title={autopilot ? "Autopilot ON — tools auto-approved" : "Autopilot OFF — tools require approval"}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs font-medium transition-colors",
          autopilot
            ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/15"
            : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted",
        )}
      >
        <Zap className={cn("h-3.5 w-3.5", autopilot && "fill-current")} />
        Autopilot
      </button>
    </div>
  );
}
