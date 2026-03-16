/**
 * SplitContainer — renders two children separated by a draggable divider.
 * ADR-052 §2.3
 */

import { useRef, useCallback, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import type { SplitDirection } from "../../stores/chat-layout-store";

const MIN_SIZE_PX = 200; // Min dimension for a pane

interface SplitContainerProps {
  direction: SplitDirection;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  children: [ReactNode, ReactNode];
}

export function SplitContainer({ direction, ratio, onRatioChange, children }: SplitContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      const el = containerRef.current;
      if (!el) return;

      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);

      const rect = el.getBoundingClientRect();

      function onMove(ev: PointerEvent) {
        if (!draggingRef.current) return;
        let newRatio: number;
        if (direction === "vertical") {
          const x = ev.clientX - rect.left;
          newRatio = x / rect.width;
        } else {
          const y = ev.clientY - rect.top;
          newRatio = y / rect.height;
        }
        // Clamp by min size
        const totalSize = direction === "vertical" ? rect.width : rect.height;
        const minRatio = MIN_SIZE_PX / totalSize;
        const maxRatio = 1 - minRatio;
        newRatio = Math.max(minRatio, Math.min(maxRatio, newRatio));
        onRatioChange(newRatio);
      }

      function onUp() {
        draggingRef.current = false;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      }

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [direction, onRatioChange],
  );

  const isVertical = direction === "vertical";
  const first = `${ratio * 100}%`;
  const second = `${(1 - ratio) * 100}%`;

  return (
    <div
      ref={containerRef}
      className={cn("flex h-full w-full min-h-0 min-w-0", isVertical ? "flex-row" : "flex-col")}
    >
      {/* First child */}
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={isVertical ? { width: first } : { height: first }}
      >
        {children[0]}
      </div>

      {/* Divider */}
      <div
        onPointerDown={handlePointerDown}
        className={cn(
          "flex-shrink-0 bg-border hover:bg-primary/30 transition-colors z-10",
          isVertical
            ? "w-1 cursor-col-resize hover:w-1.5"
            : "h-1 cursor-row-resize hover:h-1.5",
        )}
      />

      {/* Second child */}
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={isVertical ? { width: second } : { height: second }}
      >
        {children[1]}
      </div>
    </div>
  );
}
