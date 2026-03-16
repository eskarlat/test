/**
 * SplitMenu — dropdown for split right/down/reset layout.
 * ADR-052 §2.8
 */

import { useState, useRef, useEffect } from "react";
import { Columns2, Rows2, LayoutGrid, RotateCcw } from "lucide-react";
import { cn } from "../../lib/utils";
import type { SplitDirection } from "../../stores/chat-layout-store";

interface SplitMenuProps {
  canSplit: boolean;
  onSplit: (direction: SplitDirection) => void;
  onReset: () => void;
  paneCount: number;
}

export function SplitMenu({ canSplit, onSplit, onReset, paneCount }: SplitMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
          "border border-border text-muted-foreground hover:text-foreground hover:bg-muted",
        )}
        title="Split view"
        aria-label="Split view menu"
      >
        <LayoutGrid className="h-3 w-3" />
        <span className="hidden sm:inline">Split</span>
        {paneCount > 1 && (
          <span className="text-[10px] font-mono">{paneCount}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-border bg-popover shadow-lg z-50 py-1">
          <button
            disabled={!canSplit}
            onClick={() => { onSplit("vertical"); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Columns2 className="h-3.5 w-3.5" />
            Split Right
            <kbd className="ml-auto text-[10px] text-muted-foreground font-mono">Ctrl+\</kbd>
          </button>
          <button
            disabled={!canSplit}
            onClick={() => { onSplit("horizontal"); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Rows2 className="h-3.5 w-3.5" />
            Split Down
            <kbd className="ml-auto text-[10px] text-muted-foreground font-mono">Ctrl+Shift+\</kbd>
          </button>
          {paneCount > 1 && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                onClick={() => { onReset(); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-muted transition-colors text-destructive"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Layout
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
