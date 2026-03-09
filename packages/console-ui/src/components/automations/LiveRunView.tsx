import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, XCircle, Wrench, MessageSquare, ScrollText } from "lucide-react";
import { cn } from "../../lib/utils";
import { useSocketStore } from "../../api/socket";
import { useAutomationStore, type AutomationStore } from "../../stores/automation-store";
import { RunStatusBadge } from "./RunStatusBadge";
import type {
  StepStartedEvent,
  StepCompletedEvent,
  StepFailedEvent,
  ToolCalledEvent,
  MessageDeltaEvent,
  AutomationLogEvent,
} from "../../types/automation";

// ---------------------------------------------------------------------------
// Stable selectors
// ---------------------------------------------------------------------------

const selectJoinRunRoom = (s: AutomationStore) => s.joinRunRoom;
const selectLeaveRunRoom = (s: AutomationStore) => s.leaveRunRoom;
const selectCancelRun = (s: AutomationStore) => s.cancelRun;
const selectOnStepStarted = (s: AutomationStore) => s.onStepStarted;
const selectOnStepCompleted = (s: AutomationStore) => s.onStepCompleted;
const selectOnStepFailed = (s: AutomationStore) => s.onStepFailed;
const selectOnToolCalled = (s: AutomationStore) => s.onToolCalled;
const selectOnMessageDelta = (s: AutomationStore) => s.onMessageDelta;
const selectOnAutomationLog = (s: AutomationStore) => s.onAutomationLog;

// ---------------------------------------------------------------------------
// Types for the live activity feed
// ---------------------------------------------------------------------------

interface ActivityEntry {
  id: string;
  type: "step-started" | "step-completed" | "step-failed" | "tool-called" | "message-delta" | "log";
  timestamp: string;
  content: string;
  status?: string | undefined;
}

// ---------------------------------------------------------------------------
// Step state helpers (extracted to avoid nesting depth violations)
// ---------------------------------------------------------------------------

function upsertStep(prev: StepInfo[], data: StepStartedEvent): StepInfo[] {
  const existing = prev.find((s) => s.stepId === data.stepId);
  if (existing) {
    return prev.map((s) => s.stepId === data.stepId ? { ...s, status: "running" } : s);
  }
  return [...prev, { stepId: data.stepId, stepName: data.stepName, stepIndex: data.stepIndex, status: "running" }];
}

function updateStepStatus(prev: StepInfo[], stepId: string, status: string): StepInfo[] {
  return prev.map((s) => s.stepId === stepId ? { ...s, status } : s);
}

let activityCounter = 0;

function nextActivityId(): string {
  activityCounter += 1;
  return `act-${activityCounter}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// LiveActivityFeed — scrollable live log
// ---------------------------------------------------------------------------

interface LiveActivityFeedProps {
  entries: ActivityEntry[];
}

function LiveActivityFeed({ entries }: LiveActivityFeedProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
        Waiting for activity...
      </div>
    );
  }

  return (
    <div className="max-h-80 overflow-y-auto border border-border rounded-md bg-muted/30 p-3 space-y-1.5 font-mono text-[11px]">
      {entries.map((entry) => (
        <ActivityRow key={entry.id} entry={entry} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const icon = activityIcon(entry.type);

  return (
    <div className="flex items-start gap-2">
      <span className="flex-shrink-0 mt-0.5 text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground tabular-nums flex-shrink-0">
        {formatTime(entry.timestamp)}
      </span>
      <span className={cn("break-all", entry.type === "step-failed" && "text-red-600 dark:text-red-400")}>
        {entry.content}
      </span>
      {entry.status && <RunStatusBadge status={entry.status} variant="step" />}
    </div>
  );
}

function activityIcon(type: ActivityEntry["type"]): React.ReactNode {
  switch (type) {
    case "step-started":
    case "step-completed":
    case "step-failed":
      return <MessageSquare className="h-3 w-3" aria-hidden="true" />;
    case "tool-called":
      return <Wrench className="h-3 w-3" aria-hidden="true" />;
    case "log":
      return <ScrollText className="h-3 w-3" aria-hidden="true" />;
    case "message-delta":
    default:
      return <span className="inline-block w-3 h-3 text-center">.</span>;
  }
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

// ---------------------------------------------------------------------------
// LiveStepProgress — step indicators
// ---------------------------------------------------------------------------

interface StepInfo {
  stepId: string;
  stepName: string;
  stepIndex: number;
  status: string;
}

function LiveStepProgress({ steps }: { steps: StepInfo[] }) {
  if (steps.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {steps.map((step) => (
        <div
          key={step.stepId}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium border",
            stepProgressStyle(step.status),
          )}
        >
          <span className="tabular-nums">#{step.stepIndex + 1}</span>
          <span className="truncate max-w-[120px]">{step.stepName}</span>
        </div>
      ))}
    </div>
  );
}

function stepProgressStyle(status: string): string {
  switch (status) {
    case "running":
      return "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 animate-pulse";
    case "completed":
      return "border-green-500 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300";
    case "failed":
      return "border-red-500 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300";
    case "skipped":
      return "border-yellow-500 bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300";
    case "pending":
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

// ---------------------------------------------------------------------------
// Streaming output display
// ---------------------------------------------------------------------------

function StreamingOutput({ content }: { content: string }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [content]);

  if (!content) return null;

  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">Live Output</span>
      <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto max-h-60 whitespace-pre-wrap break-words">
        {content}
        <span className="animate-pulse">|</span>
        <div ref={endRef} />
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LiveRunView
// ---------------------------------------------------------------------------

interface LiveRunViewProps {
  runId: string;
  projectId: string;
  automationId: string;
  onRunComplete: () => void;
}

export function LiveRunView({ runId, projectId, automationId, onRunComplete }: LiveRunViewProps) {
  const socket = useSocketStore((s) => s.socket);
  const joinRunRoom = useAutomationStore(selectJoinRunRoom);
  const leaveRunRoom = useAutomationStore(selectLeaveRunRoom);
  const cancelRun = useAutomationStore(selectCancelRun);
  const onStepStarted = useAutomationStore(selectOnStepStarted);
  const onStepCompleted = useAutomationStore(selectOnStepCompleted);
  const onStepFailed = useAutomationStore(selectOnStepFailed);
  const onToolCalled = useAutomationStore(selectOnToolCalled);
  const onMessageDelta = useAutomationStore(selectOnMessageDelta);
  const onAutomationLog = useAutomationStore(selectOnAutomationLog);

  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [streamContent, setStreamContent] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Add an activity entry
  const addActivity = useCallback((type: ActivityEntry["type"], content: string, status?: string) => {
    setActivities((prev) => [
      ...prev,
      { id: nextActivityId(), type, timestamp: new Date().toISOString(), content, status },
    ]);
  }, []);

  // Join/leave the run room
  useEffect(() => {
    joinRunRoom(runId);
    return () => {
      leaveRunRoom(runId);
    };
  }, [runId, joinRunRoom, leaveRunRoom]);

  // Subscribe to socket events
  useEffect(() => {
    if (!socket) return;

    const handleStepStarted = (data: StepStartedEvent) => {
      if (data.runId !== runId) return;
      onStepStarted(data);
      setSteps((prev) => upsertStep(prev, data));
      addActivity("step-started", `Step "${data.stepName}" started (model: ${data.model})`);
      setStreamContent("");
    };

    const handleStepCompleted = (data: StepCompletedEvent) => {
      if (data.runId !== runId) return;
      onStepCompleted(data);
      setSteps((prev) => updateStepStatus(prev, data.stepId, data.status));
      addActivity("step-completed", `Step completed in ${formatDurationMs(data.durationMs)}`, data.status);
    };

    const handleStepFailed = (data: StepFailedEvent) => {
      if (data.runId !== runId) return;
      onStepFailed(data);
      setSteps((prev) => updateStepStatus(prev, data.stepId, "failed"));
      addActivity("step-failed", `Step failed: ${data.error}`);
    };

    const handleToolCalled = (data: ToolCalledEvent) => {
      if (data.runId !== runId) return;
      onToolCalled(data);
      const statusLabel = data.success ? "OK" : "FAIL";
      const autopilotLabel = data.autoApproved ? " [autopilot]" : "";
      addActivity("tool-called", `${data.toolName} (${data.source}) - ${statusLabel} ${formatDurationMs(data.durationMs)}${autopilotLabel}`);
    };

    const handleMessageDelta = (data: MessageDeltaEvent) => {
      if (data.runId !== runId) return;
      onMessageDelta(data);
      setStreamContent((prev) => prev + data.deltaContent);
    };

    const handleAutomationLog = (data: AutomationLogEvent) => {
      if (data.runId !== runId) return;
      onAutomationLog(data);
      addActivity("log", `[${data.level}] ${data.message}`);
    };

    const handleRunCompleted = () => {
      leaveRunRoom(runId);
      onRunComplete();
    };

    socket.on("automation:step-started", handleStepStarted);
    socket.on("automation:step-completed", handleStepCompleted);
    socket.on("automation:step-failed", handleStepFailed);
    socket.on("automation:tool-called", handleToolCalled);
    socket.on("automation:message-delta", handleMessageDelta);
    socket.on("automation:log", handleAutomationLog);
    socket.on("automation:run-completed", handleRunCompleted);

    return () => {
      socket.off("automation:step-started", handleStepStarted);
      socket.off("automation:step-completed", handleStepCompleted);
      socket.off("automation:step-failed", handleStepFailed);
      socket.off("automation:tool-called", handleToolCalled);
      socket.off("automation:message-delta", handleMessageDelta);
      socket.off("automation:log", handleAutomationLog);
      socket.off("automation:run-completed", handleRunCompleted);
    };
  }, [socket, runId, onStepStarted, onStepCompleted, onStepFailed, onToolCalled, onMessageDelta, onAutomationLog, onRunComplete, leaveRunRoom, addActivity]);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    try {
      await cancelRun(projectId, automationId, runId);
    } catch {
      // Cancel error will be shown via toast
    } finally {
      setCancelling(false);
    }
  }, [cancelRun, projectId, automationId, runId]);

  return (
    <div className="space-y-4 border border-blue-500/30 rounded-lg p-4 bg-blue-50/30 dark:bg-blue-950/10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />
          <span className="text-sm font-medium">Live Run in Progress</span>
        </div>
        <button
          onClick={handleCancel}
          disabled={cancelling}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
            "bg-red-600 text-white hover:bg-red-700 transition-colors",
            cancelling && "opacity-50 cursor-not-allowed",
          )}
        >
          {cancelling ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <XCircle className="h-3 w-3" aria-hidden="true" />
          )}
          Cancel Run
        </button>
      </div>

      {/* Step progress */}
      <LiveStepProgress steps={steps} />

      {/* Streaming output */}
      <StreamingOutput content={streamContent} />

      {/* Activity feed */}
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Activity Log</span>
        <LiveActivityFeed entries={activities} />
      </div>
    </div>
  );
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
