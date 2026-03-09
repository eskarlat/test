import { useState, useCallback } from "react";
import { HelpCircle, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

interface SectionHelpProps {
  title: string;
  children: React.ReactNode;
}

export function SectionHelp({ title, children }: SectionHelpProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "inline-flex items-center gap-1 text-xs text-muted-foreground",
          "hover:text-foreground transition-colors rounded-md px-1 py-0.5",
        )}
        aria-expanded={expanded}
        aria-label={`Help: ${title}`}
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        {expanded ? (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        )}
        <span>{title}</span>
      </button>

      {expanded && (
        <div className="mt-1.5 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1.5">
          {children}
        </div>
      )}
    </div>
  );
}
