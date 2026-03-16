import { AlignJustify, LayoutList, Maximize2 } from "lucide-react";
import { useChatPreferencesStore, type ToolDisplayMode } from "../../stores/chat-preferences-store";
import { cn } from "../../lib/utils";

const modes: Array<{ value: ToolDisplayMode; icon: typeof AlignJustify; label: string }> = [
  { value: "compact", icon: AlignJustify, label: "Compact" },
  { value: "standard", icon: LayoutList, label: "Standard" },
  { value: "verbose", icon: Maximize2, label: "Verbose" },
];

export function ToolDisplayModeSelector() {
  const toolDisplayMode = useChatPreferencesStore((s) => s.toolDisplayMode);
  const setToolDisplayMode = useChatPreferencesStore((s) => s.setToolDisplayMode);

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/50 p-0.5">
      {modes.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setToolDisplayMode(value)}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
            toolDisplayMode === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          title={`${label} tool display`}
          aria-label={`${label} tool display`}
          aria-pressed={toolDisplayMode === value}
        >
          <Icon className="h-3 w-3" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
