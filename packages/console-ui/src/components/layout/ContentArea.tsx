import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { AlertTriangle, RefreshCw } from "lucide-react";

function GlobalFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : null;
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
      <AlertTriangle className="h-12 w-12 text-destructive" aria-hidden="true" />
      <div>
        <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-md">
          An unexpected error occurred. Check the browser console for details.
        </p>
        {message && (
          <pre className="mt-3 text-xs text-left bg-muted rounded p-3 max-w-lg overflow-auto">
            {message}
          </pre>
        )}
      </div>
      <button
        onClick={resetErrorBoundary}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors border border-border rounded-md px-3 py-1.5"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}

export function GlobalErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary fallbackRender={GlobalFallback}>
      {children}
    </ErrorBoundary>
  );
}
