import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { Play, Pencil, Trash2, Clock, MoreVertical, Loader2, History } from "lucide-react";
import { cn } from "../../lib/utils";
import { useAutomationStore } from "../../stores/automation-store";
import { useNotificationStore } from "../../stores/notification-store";
import type { AutomationListItem } from "../../types/automation";
import { AutopilotDialog } from "./AutopilotDialog";

interface AutomationCardProps {
  automation: AutomationListItem;
  projectId: string;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

function formatSchedule(automation: AutomationListItem): string {
  if (automation.scheduleType === "manual") return "Manual trigger only";
  if (automation.scheduleType === "once") return "One-time";
  if (automation.scheduleCron) return automation.scheduleCron;
  return "Scheduled";
}

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return "text-green-600 dark:text-green-400";
    case "completed_with_warnings":
      return "text-amber-600 dark:text-amber-400";
    case "running":
    case "pending":
      return "text-blue-600 dark:text-blue-400";
    case "failed":
    case "timed_out":
      return "text-red-600 dark:text-red-400";
    case "cancelled":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "Passed";
    case "completed_with_warnings":
      return "Warnings";
    case "running":
      return "Running";
    case "pending":
      return "Pending";
    case "failed":
      return "Failed";
    case "timed_out":
      return "Timed out";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

// ---------------------------------------------------------------------------
// CardActionsMenu — extracted to reduce cyclomatic complexity
// ---------------------------------------------------------------------------

interface CardActionsMenuProps {
  automationId: string;
  projectId: string;
}

function CardActionsMenu({ automationId, projectId }: CardActionsMenuProps) {
  const navigate = useNavigate();
  const deleteAutomation = useAutomationStore((s) => s.deleteAutomation);
  const addToast = useNotificationStore((s) => s.addToast);

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleViewHistory = useCallback(() => {
    setMenuOpen(false);
    navigate(`/${projectId}/automations/${automationId}/runs`);
  }, [navigate, projectId, automationId]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deleteAutomation(projectId, automationId);
      addToast("Automation deleted", "info");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to delete", "error");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
      setMenuOpen(false);
    }
  }, [confirmDelete, deleteAutomation, projectId, automationId, addToast]);

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((prev) => !prev)}
        className={cn(
          "inline-flex items-center rounded-md p-1 text-xs font-medium",
          "bg-accent text-accent-foreground hover:bg-accent/80 transition-colors",
        )}
        aria-label="More actions"
      >
        <MoreVertical className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setMenuOpen(false); setConfirmDelete(false); }} />
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-md">
            <button
              onClick={handleViewHistory}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent transition-colors"
            >
              <History className="h-3 w-3" aria-hidden="true" />
              View History
            </button>

            {!confirmDelete ? (
              <button
                onClick={handleDelete}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                Delete
              </button>
            ) : (
              <div className="px-2 py-1.5 space-y-1.5">
                <p className="text-xs text-muted-foreground">Delete this automation?</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
                      "bg-red-600 text-white hover:bg-red-700 transition-colors",
                      deleting && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    {deleting && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LastRunDisplay
// ---------------------------------------------------------------------------

function LastRunDisplay({ lastRun }: { lastRun: AutomationListItem["lastRun"] }) {
  if (!lastRun) {
    return <span>Never run</span>;
  }
  return (
    <span className="flex items-center gap-1">
      Last:
      <span className={statusColor(lastRun.status)}>{statusLabel(lastRun.status)}</span>
      <span>{formatRelativeTime(lastRun.startedAt)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ToggleSwitch
// ---------------------------------------------------------------------------

interface ToggleSwitchProps {
  enabled: boolean;
  disabled: boolean;
  onClick: () => void;
  enableLabel: string;
  disableLabel: string;
}

function ToggleSwitch({ enabled, disabled, onClick, enableLabel, disableLabel }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={enabled ? disableLabel : enableLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors",
        enabled ? "bg-green-500" : "bg-muted-foreground/30",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5",
          enabled ? "translate-x-4.5 ml-0.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// AutomationCard
// ---------------------------------------------------------------------------

export function AutomationCard({ automation, projectId }: AutomationCardProps) {
  const navigate = useNavigate();
  const triggerRun = useAutomationStore((s) => s.triggerRun);
  const toggleAutomation = useAutomationStore((s) => s.toggleAutomation);
  const addToast = useNotificationStore((s) => s.addToast);

  const [running, setRunning] = useState(false);
  const [autopilotOpen, setAutopilotOpen] = useState(false);
  const [pendingToggle, setPendingToggle] = useState(false);

  const handleRunNow = useCallback(async () => {
    setRunning(true);
    try {
      const runId = await triggerRun(projectId, automation.id);
      addToast(`Run started (${runId.slice(0, 8)})`, "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to trigger run", "error");
    } finally {
      setRunning(false);
    }
  }, [triggerRun, projectId, automation.id, addToast]);

  const handleToggleClick = useCallback(() => {
    if (!automation.enabled) {
      setAutopilotOpen(true);
      return;
    }
    setPendingToggle(true);
    toggleAutomation(projectId, automation.id, false)
      .then(() => addToast("Automation disabled", "info"))
      .catch((err) => addToast(err instanceof Error ? err.message : "Failed to disable", "error"))
      .finally(() => setPendingToggle(false));
  }, [automation.enabled, automation.id, projectId, toggleAutomation, addToast]);

  const handleAutopilotConfirm = useCallback(() => {
    setAutopilotOpen(false);
    setPendingToggle(true);
    toggleAutomation(projectId, automation.id, true)
      .then(() => addToast("Automation enabled (autopilot)", "success"))
      .catch((err) => addToast(err instanceof Error ? err.message : "Failed to enable", "error"))
      .finally(() => setPendingToggle(false));
  }, [projectId, automation.id, toggleAutomation, addToast]);

  const handleEdit = useCallback(() => {
    navigate(`/${projectId}/automations/${automation.id}/edit`);
  }, [navigate, projectId, automation.id]);

  const runDisabled = running || !automation.enabled;
  const stepSuffix = automation.chainStepCount !== 1 ? "s" : "";
  const RunIcon = running ? Loader2 : Play;

  return (
    <>
      <div
        className={cn(
          "rounded-lg border border-border bg-card p-4 space-y-3 transition-shadow",
          automation.enabled && "border-green-500/20",
          !automation.enabled && "opacity-75",
        )}
      >
        {/* Header: name + toggle */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{automation.name}</h3>
            {automation.description && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{automation.description}</p>
            )}
          </div>
          <ToggleSwitch
            enabled={automation.enabled}
            disabled={pendingToggle}
            onClick={handleToggleClick}
            enableLabel="Enable automation"
            disableLabel="Disable automation"
          />
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {formatSchedule(automation)}
          </span>
          <span>{automation.chainStepCount} step{stepSuffix}</span>
          <LastRunDisplay lastRun={automation.lastRun} />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={handleRunNow}
            disabled={runDisabled}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
              "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
              runDisabled && "opacity-50 cursor-not-allowed",
            )}
          >
            <RunIcon className={cn("h-3 w-3", running && "animate-spin")} aria-hidden="true" />
            Run Now
          </button>

          <button
            onClick={handleEdit}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
              "bg-accent text-accent-foreground hover:bg-accent/80 transition-colors",
            )}
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
            Edit
          </button>

          <CardActionsMenu automationId={automation.id} projectId={projectId} />
        </div>
      </div>

      <AutopilotDialog
        open={autopilotOpen}
        onConfirm={handleAutopilotConfirm}
        onCancel={() => setAutopilotOpen(false)}
      />
    </>
  );
}
