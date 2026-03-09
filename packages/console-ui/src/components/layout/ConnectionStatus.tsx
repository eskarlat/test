import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { useConnectionStore } from "../../stores/connection-store";

export function ConnectionStatus() {
  const status = useConnectionStore((s) => s.status);
  const [visible, setVisible] = useState(true);

  // Auto-hide the green dot after 3s when connected
  useEffect(() => {
    if (status === "connected") {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 3000);
      return () => clearTimeout(timer);
    } else {
      setVisible(true);
    }
  }, [status]);

  if (status === "connected" && !visible) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs" aria-live="polite">
      {status === "connected" && (
        <>
          <span className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" aria-hidden="true" />
          <span className="text-muted-foreground sr-only">Connected</span>
        </>
      )}
      {status === "reconnecting" && (
        <>
          <span
            className={cn(
              "h-2 w-2 rounded-full bg-amber-500 flex-shrink-0",
              "animate-pulse"
            )}
            aria-hidden="true"
          />
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            Reconnecting...
          </span>
        </>
      )}
      {status === "disconnected" && (
        <>
          <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" aria-hidden="true" />
          <span className="text-red-600 dark:text-red-400 font-medium">Server offline</span>
        </>
      )}
    </div>
  );
}
