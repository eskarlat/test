import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { AlertTriangle, RefreshCw } from "lucide-react";

function GlobalFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
      <AlertTriangle className="h-12 w-12 text-destructive" aria-hidden="true" />
      <div className="max-w-2xl w-full">
        <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
        <pre className="mt-3 text-xs text-left bg-muted rounded p-3 overflow-auto max-h-60 whitespace-pre-wrap break-words">
          {message}
        </pre>
        {stack && (
          <details className="mt-2 text-left">
            <summary className="text-xs text-muted-foreground cursor-pointer">Stack trace</summary>
            <pre className="mt-1 text-[10px] bg-muted rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap break-words">
              {stack}
            </pre>
          </details>
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
