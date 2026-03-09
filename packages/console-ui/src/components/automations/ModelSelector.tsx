import { cn } from "../../lib/utils";
import type { ModelInfo } from "../../types/automation";

interface ModelSelectorProps {
  models: ModelInfo[];
  value: string;
  onChange: (modelId: string) => void;
}

export function ModelSelector({ models, value, onChange }: ModelSelectorProps) {
  return (
    <div className="space-y-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
          "focus:outline-none focus:ring-2 focus:ring-primary/50",
        )}
      >
        <option value="">Select a model</option>
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>

      {/* Capability badges for the selected model */}
      {value && (() => {
        const selected = models.find((m) => m.id === value);
        if (!selected?.capabilities?.length) return null;
        return (
          <div className="flex flex-wrap gap-1">
            {selected.capabilities.map((cap) => (
              <span
                key={cap}
                className="inline-block rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground"
              >
                {cap}
              </span>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
