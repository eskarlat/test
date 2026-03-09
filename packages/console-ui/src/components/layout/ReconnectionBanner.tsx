import { useState } from "react";
import { WifiOff, RefreshCw, Terminal } from "lucide-react";
import { useConnectionStore } from "../../stores/connection-store";

export function ReconnectionBanner() {
  const status = useConnectionStore((s) => s.status);
  const [showTooltip, setShowTooltip] = useState(false);

  if (status !== "disconnected") return null;

  function handleReconnect() {
    // Trigger reconnection by resetting attempts — the useWorkerEvents hook will
    // pick this up via connection store state change and reconnect
    useConnectionStore.getState().resetReconnectAttempts();
    useConnectionStore.getState().setStatus("reconnecting");
  }

  return (
    <div
      className="flex items-center gap-3 bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 px-4 py-2 text-sm"
      role="alert"
    >
      <WifiOff className="h-3.5 w-3.5 text-red-500 flex-shrink-0" aria-hidden="true" />
      <span className="text-red-700 dark:text-red-300 flex-1">
        Server offline — showing cached data.
      </span>
      <button
        onClick={handleReconnect}
        className="flex items-center gap-1.5 text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100 font-medium transition-colors"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Reconnect
      </button>
      <div className="relative">
        <button
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          onFocus={() => setShowTooltip(true)}
          onBlur={() => setShowTooltip(false)}
          className="flex items-center gap-1.5 text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-100 transition-colors"
          aria-label="How to start the server"
        >
          <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
          How to start
        </button>
        {showTooltip && (
          <div
            className="absolute right-0 top-7 z-50 rounded-md bg-popover border border-border shadow-lg p-3 min-w-48"
            role="tooltip"
          >
            <p className="text-xs text-muted-foreground mb-1">Start the worker service:</p>
            <code className="block text-xs font-mono bg-muted rounded px-2 py-1 text-foreground">
              renre-kit start
            </code>
          </div>
        )}
      </div>
    </div>
  );
}
