import { useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { Timer, Plus, RefreshCw, Puzzle } from "lucide-react";
import { cn } from "../lib/utils";
import { useAutomationStore, type AutomationStore } from "../stores/automation-store";
import { useSocketStore } from "../api/socket";
import { useNotificationStore } from "../stores/notification-store";
import { Skeleton } from "../components/ui/Skeleton";
import { AutomationCard } from "../components/automations/AutomationCard";
import { ExtensionJobCard } from "../components/automations/ExtensionJobCard";

// Stable selectors — avoid inline arrow fns that create new refs every render
const selectAutomations = (s: AutomationStore) => s.automations;
const selectExtensionJobs = (s: AutomationStore) => s.extensionJobs;
const selectLoading = (s: AutomationStore) => s.loading;
const selectError = (s: AutomationStore) => s.error;
const selectFetchAutomations = (s: AutomationStore) => s.fetchAutomations;
const selectFetchExtensionJobs = (s: AutomationStore) => s.fetchExtensionJobs;
const selectFetchModels = (s: AutomationStore) => s.fetchModels;
const selectOnRunStarted = (s: AutomationStore) => s.onRunStarted;
const selectOnRunCompleted = (s: AutomationStore) => s.onRunCompleted;

export default function AutomationsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const automations = useAutomationStore(selectAutomations);
  const extensionJobs = useAutomationStore(selectExtensionJobs);
  const loading = useAutomationStore(selectLoading);
  const error = useAutomationStore(selectError);
  const fetchAutomations = useAutomationStore(selectFetchAutomations);
  const fetchExtensionJobs = useAutomationStore(selectFetchExtensionJobs);
  const fetchModels = useAutomationStore(selectFetchModels);
  const onRunStarted = useAutomationStore(selectOnRunStarted);
  const onRunCompleted = useAutomationStore(selectOnRunCompleted);

  const socket = useSocketStore((s) => s.socket);
  const addToast = useNotificationStore((s) => s.addToast);

  // Fetch data on mount
  useEffect(() => {
    if (!projectId) return;
    fetchAutomations(projectId);
    fetchExtensionJobs(projectId);
    fetchModels(projectId);
  }, [projectId, fetchAutomations, fetchExtensionJobs, fetchModels]);

  // Subscribe to Socket.IO automation events
  useEffect(() => {
    if (!socket) return;

    const handleRunStarted = (data: Parameters<typeof onRunStarted>[0]) => {
      onRunStarted(data);
      addToast(`Automation "${data.automationName}" started`, "info");
    };

    const handleRunCompleted = (data: Parameters<typeof onRunCompleted>[0]) => {
      onRunCompleted(data);
      let type: "success" | "error" | "info" = "info";
      if (data.status === "completed") type = "success";
      else if (data.status === "failed") type = "error";
      addToast(`Automation run ${data.status}`, type);
    };

    socket.on("automation:run-started", handleRunStarted);
    socket.on("automation:run-completed", handleRunCompleted);

    return () => {
      socket.off("automation:run-started", handleRunStarted);
      socket.off("automation:run-completed", handleRunCompleted);
    };
  }, [socket, onRunStarted, onRunCompleted, addToast]);

  const handleRetry = useCallback(() => {
    if (!projectId) return;
    fetchAutomations(projectId);
    fetchExtensionJobs(projectId);
  }, [projectId, fetchAutomations, fetchExtensionJobs]);

  const handleNewAutomation = useCallback(() => {
    if (!projectId) return;
    navigate(`/${projectId}/automations/new`);
  }, [projectId, navigate]);

  if (!projectId) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        Select a project to view automations.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Timer className="h-5 w-5" aria-hidden="true" />
            Automations
          </h1>
          <p className="text-sm text-muted-foreground">
            Create and manage prompt chain automations with scheduling, worktree isolation, and tool access.
          </p>
        </div>

        <button
          onClick={handleNewAutomation}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
            "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
          )}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Automation
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-4 w-72" />
              <div className="flex gap-2">
                <Skeleton className="h-7 w-20" />
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-7 w-14" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="rounded-lg border border-red-500/30 bg-red-50 dark:bg-red-950/30 p-6 text-center space-y-3">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={handleRetry}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
              "bg-accent text-accent-foreground hover:bg-accent/80 transition-colors",
            )}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {/* User Automations section */}
      {!loading && !error && (
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-medium">User Automations</h2>
            <p className="text-xs text-muted-foreground">
              Prompt chains that run on a schedule or on demand, with optional worktree isolation.
            </p>
          </div>

          {/* Empty state */}
          {automations.length === 0 && (
            <div className="rounded-lg border border-border border-dashed p-12 text-center space-y-3">
              <Timer className="h-10 w-10 mx-auto text-muted-foreground/50" aria-hidden="true" />
              <h3 className="text-base font-medium">No automations</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Automations let you chain prompts together, schedule them with cron, and run them in isolated
                worktrees. Create one to get started.
              </p>
              <button
                onClick={handleNewAutomation}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
                  "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors mt-2",
                )}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create Automation
              </button>
            </div>
          )}

          {/* Automation cards */}
          {automations.length > 0 && (
            <div className="space-y-3">
              {automations.map((automation) => (
                <AutomationCard
                  key={automation.id}
                  automation={automation}
                  projectId={projectId}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Extension Jobs section */}
      {!loading && !error && extensionJobs.length > 0 && (
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-base font-medium">
              <Puzzle className="h-4 w-4" aria-hidden="true" />
              Extension Jobs
            </h2>
            <p className="text-xs text-muted-foreground">
              Scheduled jobs registered by installed extensions. Toggle them on or off.
            </p>
          </div>

          <div className="space-y-3">
            {extensionJobs.map((job) => (
              <ExtensionJobCard
                key={job.id}
                job={job}
                projectId={projectId}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
