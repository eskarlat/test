import { useState, useEffect, useCallback } from "react";
import { X, Loader2, ArrowLeft, ArrowRight, Download } from "lucide-react";
import { cn } from "../../lib/utils";
import { apiPost } from "../../api/client";
import { useNotificationStore } from "../../stores/notification-store";
import { PermissionReview, type ExtensionPermissions } from "./PermissionReview";
import { SettingsStep, type SettingField, type SettingsValues } from "./SettingsStep";
import { ConfirmInstall } from "./ConfirmInstall";

export interface MarketplaceExtensionForInstall {
  name: string;
  version: string;
  description?: string;
  repository: string;
  marketplace?: string;
  tags?: string[];
  author?: string;
  permissions?: ExtensionPermissions;
  settings?: {
    schema: SettingField[];
  };
}

interface InstallDialogProps {
  projectId: string;
  extension: MarketplaceExtensionForInstall;
  onClose: () => void;
  onInstalled: () => void;
}

type Step = "permissions" | "settings" | "confirm";

function buildStepList(extension: MarketplaceExtensionForInstall): Step[] {
  const hasRequiredSettings = (extension.settings?.schema ?? []).some((f) => f.required);
  const hasSettings = (extension.settings?.schema ?? []).length > 0;

  // One-click: no required settings → skip settings step
  if (!hasRequiredSettings && !hasSettings) {
    return ["permissions", "confirm"];
  }
  return ["permissions", "settings", "confirm"];
}

function stepLabel(step: Step): string {
  if (step === "permissions") return "Review Permissions";
  if (step === "settings") return "Configure Settings";
  return "Confirm";
}

interface StepProgressProps {
  steps: Step[];
  current: Step;
}

function stepCircleCls(i: number, currentIndex: number): string {
  if (i < currentIndex) return "bg-green-600 text-white";
  if (i === currentIndex) return "bg-primary text-primary-foreground";
  return "bg-muted text-muted-foreground";
}

function StepProgress({ steps, current }: StepProgressProps) {
  const currentIndex = steps.indexOf(current);
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => (
        <div key={step} className="flex items-center gap-2">
          <div
            className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors",
              stepCircleCls(i, currentIndex),
            )}
          >
            {i + 1}
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "h-0.5 w-8 transition-colors",
                i < currentIndex ? "bg-green-600" : "bg-muted",
              )}
            />
          )}
        </div>
      ))}
      <span className="ml-2 text-xs text-muted-foreground font-medium">
        Step {currentIndex + 1} of {steps.length} — {stepLabel(current)}
      </span>
    </div>
  );
}

function buildDefaultValues(schema: SettingField[]): SettingsValues {
  const result: SettingsValues = {};
  for (const field of schema) {
    if (field.default !== undefined) {
      result[field.key] = field.default;
    }
  }
  return result;
}

/**
 * 3-step install dialog:
 * 1. Review permissions
 * 2. Configure settings (skipped if no settings)
 * 3. Confirm + install
 * Keyboard: Enter = advance, Escape = close, Tab = navigate fields
 */
export function InstallDialog({
  projectId,
  extension,
  onClose,
  onInstalled,
}: InstallDialogProps) {
  const steps = buildStepList(extension);
  const [currentStep, setCurrentStep] = useState<Step>(steps[0]!);
  const [values, setValues] = useState<SettingsValues>(
    buildDefaultValues(extension.settings?.schema ?? []),
  );
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const currentIndex = steps.indexOf(currentStep);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === steps.length - 1;

  const advance = useCallback(() => {
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1]!);
    }
  }, [currentIndex, steps]);

  const back = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1]!);
    }
  }, [currentIndex, steps]);

  // Keyboard navigation
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Enter to advance when not on last step and not in a textarea/input
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Enter" && !isInput && !isLast && !installing) {
        advance();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, isLast, installing, advance]);

  function handleFieldChange(key: string, value: string | number | boolean) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleInstall() {
    setInstalling(true);
    setInstallError(null);

    const result = await apiPost<{ ok: boolean }>(`/api/${projectId}/extensions/install`, {
      name: extension.name,
      version: extension.version,
      repository: extension.repository,
      marketplace: extension.marketplace,
      settings: values,
    });

    if (result.error) {
      setInstallError(result.error);
      setInstalling(false);
    } else {
      useNotificationStore.getState().addToast(
        `${extension.name}@${extension.version} installed successfully`,
        "success",
      );
      onInstalled();
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel */}
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-background shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-border">
          <div className="min-w-0">
            <h2
              id="install-dialog-title"
              className="text-base font-semibold text-foreground truncate"
            >
              Install {extension.name} v{extension.version}
            </h2>
            <div className="mt-2">
              <StepProgress steps={steps} current={currentStep} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors hover:bg-accent"
            aria-label="Close install dialog"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Step content */}
        <div className="px-6 py-4 min-h-[200px]">
          {currentStep === "permissions" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This extension requests the following permissions:
              </p>
              <PermissionReview permissions={extension.permissions} />
            </div>
          )}

          {currentStep === "settings" && (
            <SettingsStep
              schema={extension.settings?.schema ?? []}
              values={values}
              onChange={handleFieldChange}
            />
          )}

          {currentStep === "confirm" && (
            <ConfirmInstall
              extension={extension}
              schema={extension.settings?.schema ?? []}
              values={values}
            />
          )}

          {installError && (
            <div className="mt-4 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2">
              <p className="text-sm text-destructive">{installError}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border bg-muted/30">
          <div>
            {!isFirst && (
              <button
                type="button"
                onClick={back}
                disabled={installing}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={installing}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              Cancel
            </button>

            {!isLast && (
              <button
                type="button"
                onClick={advance}
                className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Accept &amp; Next
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}

            {isLast && (
              <button
                type="button"
                onClick={() => void handleInstall()}
                disabled={installing}
                className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {installing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Install
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
