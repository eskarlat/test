import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router";
import { Settings, X } from "lucide-react";
import { useContextRecipeStore, type ProviderConfig } from "../stores/context-recipe-store";
import { useNotificationStore } from "../stores/notification-store";
import { PageHeader } from "../components/intelligence/shared/PageHeader";
import { EmptyState } from "../components/intelligence/shared/EmptyState";
import { cn } from "../lib/utils";

interface PreviewDialogProps {
  content: string;
  onClose: () => void;
}

function PreviewDialog({ content, onClose }: PreviewDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-dialog-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl rounded-xl border border-border bg-background shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 id="preview-dialog-title" className="text-base font-semibold">
            Context Preview
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[70vh]">
          <pre className="text-xs text-foreground whitespace-pre-wrap font-mono bg-muted rounded p-4 overflow-x-auto">
            {content}
          </pre>
        </div>
      </div>
    </div>
  );
}

interface ProviderRowProps {
  provider: ProviderConfig;
  onChange: (updated: ProviderConfig) => void;
}

function ProviderRow({ provider, onChange }: ProviderRowProps) {
  const [configExpanded, setConfigExpanded] = useState(false);
  const [configText, setConfigText] = useState(
    JSON.stringify(provider.config, null, 2)
  );
  const [configError, setConfigError] = useState<string | null>(null);

  const hasConfig = Object.keys(provider.config).length > 0;

  function handleConfigSave() {
    try {
      const parsed = JSON.parse(configText) as Record<string, unknown>;
      onChange({ ...provider, config: parsed });
      setConfigError(null);
      setConfigExpanded(false);
    } catch {
      setConfigError("Invalid JSON");
    }
  }

  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <input
          type="checkbox"
          checked={provider.enabled}
          onChange={(e) => onChange({ ...provider, enabled: e.target.checked })}
          className="accent-primary flex-shrink-0"
          id={`provider-${provider.id}`}
        />
        <div className="flex-1 min-w-0">
          <label
            htmlFor={`provider-${provider.id}`}
            className="block text-sm font-medium cursor-pointer"
          >
            {provider.name}
          </label>
          {provider.description && (
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
              {provider.description}
            </p>
          )}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
          ~{provider.estimatedTokens.toLocaleString()} tokens
        </span>
        {hasConfig && (
          <button
            type="button"
            onClick={() => setConfigExpanded((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors flex-shrink-0",
              configExpanded
                ? "border-ring text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <Settings className="h-3 w-3" />
            Configure
          </button>
        )}
      </div>
      {configExpanded && hasConfig && (
        <div className="px-4 pb-3 bg-muted/30">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Provider Config (JSON)
            </label>
            <textarea
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 text-xs font-mono rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
            {configError && (
              <p className="text-xs text-destructive">{configError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleConfigSave}
                className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfigText(JSON.stringify(provider.config, null, 2));
                  setConfigExpanded(false);
                  setConfigError(null);
                }}
                className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getBudgetBarColor(pct: number): string {
  if (pct > 90) return "bg-red-500";
  if (pct > 70) return "bg-yellow-500";
  return "bg-primary";
}

interface ContextRecipeContentProps {
  loading: boolean;
  error: string | null;
  budgetPct: number;
  estimatedTotal: number;
  localBudget: number;
  setLocalBudget: (v: number) => void;
  localProviders: ProviderConfig[];
  handleProviderChange: (updated: ProviderConfig) => void;
}

function ContextRecipeContent({
  loading,
  error,
  budgetPct,
  estimatedTotal,
  localBudget,
  setLocalBudget,
  localProviders,
  handleProviderChange,
}: ContextRecipeContentProps) {
  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading context recipe...</div>;
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {/* Token budget */}
      <div className="rounded-lg border border-border bg-card p-4">
        <label className="block text-sm font-semibold text-foreground mb-3">Token Budget</label>
        <div className="flex items-center gap-3 mb-3">
          <input
            type="number"
            value={localBudget}
            onChange={(e) => setLocalBudget(Math.max(0, Number(e.target.value)))}
            min={0}
            step={1000}
            className="w-32 px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring tabular-nums"
          />
          <span className="text-xs text-muted-foreground">tokens</span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Estimated: {estimatedTotal.toLocaleString()} tokens</span>
            <span>{budgetPct.toFixed(1)}% of budget</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", getBudgetBarColor(budgetPct))}
              style={{ width: `${Math.min(100, budgetPct)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Provider list */}
      {localProviders.length === 0 ? (
        <EmptyState
          title="No providers configured"
          description="Context providers will appear here once the worker is running."
        />
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-2 bg-muted/50 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Context Providers
            </p>
          </div>
          <div className="divide-y divide-border">
            {localProviders.map((provider) => (
              <ProviderRow key={provider.id} provider={provider} onChange={handleProviderChange} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ContextRecipesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const {
    providers,
    tokenBudget,
    preview,
    previewLoading,
    loading,
    error,
    fetchRecipe,
    saveRecipe,
    fetchPreview,
  } = useContextRecipeStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [localProviders, setLocalProviders] = useState<ProviderConfig[]>([]);
  const [localBudget, setLocalBudget] = useState(tokenBudget);
  const [showPreview, setShowPreview] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (!projectId) return;
    fetchRecipe(projectId).catch(() => {});
  }, [projectId, fetchRecipe]);

  useEffect(() => {
    setLocalProviders(providers);
    setLocalBudget(tokenBudget);
  }, [providers, tokenBudget]);

  const debouncedSave = useCallback(
    (nextProviders: ProviderConfig[], nextBudget: number) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveRecipe(projectId!, nextProviders, nextBudget)
          .then(() => addToast("Context recipe saved", "success"))
          .catch(() => {});
      }, 500);
    },
    [projectId, saveRecipe, addToast],
  );

  useEffect(() => {
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, []);

  if (!projectId) return null;

  const estimatedTotal = localProviders
    .filter((p) => p.enabled)
    .reduce((s, p) => s + p.estimatedTokens, 0);

  const budgetPct = localBudget > 0 ? Math.min(100, (estimatedTotal / localBudget) * 100) : 0;

  function handleProviderChange(updated: ProviderConfig) {
    const next = localProviders.map((p) => (p.id === updated.id ? updated : p));
    setLocalProviders(next);
    debouncedSave(next, localBudget);
  }

  function handleBudgetChange(value: number) {
    setLocalBudget(value);
    debouncedSave(localProviders, value);
  }

  function handleReset() {
    fetchRecipe(projectId!).catch(() => {});
  }

  async function handlePreview() {
    await fetchPreview(projectId!);
    setShowPreview(true);
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Context Recipes"
        description="Configure what context is provided to agent sessions"
        breadcrumbs={[
          { label: "Dashboard", to: `/${projectId}` },
          { label: "Context Recipes" },
        ]}
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="px-3 py-1.5 text-sm rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => void handlePreview()}
              disabled={previewLoading}
              className="px-3 py-1.5 text-sm rounded-md border border-border text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              {previewLoading ? "Loading..." : "Preview Context"}
            </button>
          </div>
        }
      />

      <ContextRecipeContent
        loading={loading}
        error={error}
        budgetPct={budgetPct}
        estimatedTotal={estimatedTotal}
        localBudget={localBudget}
        setLocalBudget={handleBudgetChange}
        localProviders={localProviders}
        handleProviderChange={handleProviderChange}
      />

      {showPreview && preview && (
        <PreviewDialog content={preview} onClose={() => setShowPreview(false)} />
      )}
    </div>
  );
}
