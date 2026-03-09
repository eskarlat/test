import { ErrorBoundary } from "react-error-boundary";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { invalidateExtensionModule } from "../../lib/extension-loader";

interface Props {
  children: React.ReactNode;
  extensionName: string;
}

function ExtensionFallback({
  error,
  resetErrorBoundary,
  extensionName,
}: {
  error: Error;
  resetErrorBoundary: () => void;
  extensionName: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 text-center p-8 bg-destructive/5 rounded-lg border border-destructive/20">
      <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
      <div>
        <h3 className="text-base font-semibold text-foreground">Extension crashed</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          <strong>{extensionName}</strong> encountered an error and has been stopped.
        </p>
        {error.message && (
          <pre className="mt-2 text-xs text-left bg-muted rounded p-2 max-w-sm overflow-auto">
            {error.message}
          </pre>
        )}
      </div>
      <button
        onClick={() => {
          invalidateExtensionModule(extensionName);
          resetErrorBoundary();
        }}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors border border-border rounded-md px-3 py-1.5"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Reload Extension
      </button>
    </div>
  );
}

export function ExtensionErrorBoundary({ children, extensionName }: Props) {
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <ExtensionFallback
          error={error as Error}
          resetErrorBoundary={resetErrorBoundary}
          extensionName={extensionName}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
