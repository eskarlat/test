/**
 * ChatPane — independent session pane with its own socket room, input, and streaming.
 * ADR-052 §2.2
 *
 * Each pane joins/leaves its session's Socket.IO room independently and
 * renders its own ChatMessageList, ChatInput, permission dialogs, etc.
 */

import { useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router";
import { useSocketStore } from "../../api/socket";
import {
  useChatStore,
  type ChatState,
  onSessionMessageDelta,
  onSessionReasoningDelta,
  onSessionTurnStart,
  onVisibilityChange,
  createDefaultSessionState,
} from "../../stores/chat-store";
import {
  createStreamingAssistantMessage,
  createCompactionStartMessage,
  createErrorMessage,
  buildCompactionCompleteUpdate,
  buildToolStartUpdate,
  buildToolCompleteUpdate,
  buildSubagentStartUpdate,
  buildSubagentCompleteUpdate,
} from "../../lib/chat-socket-handlers";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";
import { ChatContextBar } from "./ChatContextBar";
import { ChatPermissionBanner } from "./ChatPermissionBanner";
import { ChatInputDialog } from "./ChatInputDialog";
import { ChatElicitationDialog } from "./ChatElicitationDialog";
import { ChatPaneHeader } from "./ChatPaneHeader";
import { ChatSessionPickerDialog } from "./ChatSessionPickerDialog";

// ---------------------------------------------------------------------------
// Deduplication tracker for pending initial messages
// ---------------------------------------------------------------------------

const sentPendingPanes = new Set<string>();

// ---------------------------------------------------------------------------
// Per-session tool/subagent state updaters
// These wrap the shared buildXxx helpers with per-session state tracking.
// ---------------------------------------------------------------------------

function paneToolStartUpdate(
  sessionId: string,
  data: { toolCallId: string; roundId: string; toolName: string; toolArgs?: Record<string, unknown> },
): (s: ChatState) => Partial<ChatState> {
  const baseUpdate = buildToolStartUpdate(sessionId, data);
  return (s) => {
    const base = baseUpdate(s);
    // Sync to per-session state
    const ss = s.sessionStates.get(sessionId) ?? createDefaultSessionState();
    const tools = new Map(ss.activeTools);
    tools.set(data.toolCallId, { ...data, status: "running", startedAt: Date.now() });
    const newStates = new Map(s.sessionStates);
    newStates.set(sessionId, { ...ss, activeTools: tools });
    const topLevel: Partial<ChatState> = { ...base, sessionStates: newStates };
    if (s.activeSessionId === sessionId) topLevel.activeTools = tools;
    return topLevel;
  };
}

function paneToolCompleteUpdate(
  sessionId: string,
  data: { toolCallId: string; toolName?: string; result?: Record<string, unknown>; success?: boolean; error?: unknown },
): (s: ChatState) => Partial<ChatState> {
  const baseUpdate = buildToolCompleteUpdate(sessionId, data);
  return (s) => {
    const base = baseUpdate(s);
    const ss = s.sessionStates.get(sessionId) ?? createDefaultSessionState();
    const tools = new Map(ss.activeTools);
    tools.delete(data.toolCallId);
    const newStates = new Map(s.sessionStates);
    newStates.set(sessionId, { ...ss, activeTools: tools });
    const topLevel: Partial<ChatState> = { ...base, sessionStates: newStates };
    if (s.activeSessionId === sessionId) topLevel.activeTools = tools;
    return topLevel;
  };
}

function paneSubagentStartUpdate(
  sessionId: string,
  data: { toolCallId: string; agentName: string; agentDisplayName?: string },
): (s: ChatState) => Partial<ChatState> {
  const baseUpdate = buildSubagentStartUpdate(sessionId, data);
  return (s) => {
    const base = baseUpdate(s);
    const ss = s.sessionStates.get(sessionId) ?? createDefaultSessionState();
    const subs = new Map(ss.activeSubagents);
    subs.set(data.toolCallId, { ...data, status: "running", startedAt: Date.now() });
    const newStates = new Map(s.sessionStates);
    newStates.set(sessionId, { ...ss, activeSubagents: subs });
    const topLevel: Partial<ChatState> = { ...base, sessionStates: newStates };
    if (s.activeSessionId === sessionId) topLevel.activeSubagents = subs;
    return topLevel;
  };
}

function paneSubagentCompleteUpdate(
  sessionId: string,
  data: { toolCallId: string },
): (s: ChatState) => Partial<ChatState> {
  const baseUpdate = buildSubagentCompleteUpdate(sessionId, data);
  return (s) => {
    const base = baseUpdate(s);
    const ss = s.sessionStates.get(sessionId) ?? createDefaultSessionState();
    const subs = new Map(ss.activeSubagents);
    subs.delete(data.toolCallId);
    const newStates = new Map(s.sessionStates);
    newStates.set(sessionId, { ...ss, activeSubagents: subs });
    const topLevel: Partial<ChatState> = { ...base, sessionStates: newStates };
    if (s.activeSessionId === sessionId) topLevel.activeSubagents = subs;
    return topLevel;
  };
}

// ---------------------------------------------------------------------------
// Socket binding for a specific pane+session pair
// ---------------------------------------------------------------------------

function usePaneSocket(paneId: string, sessionId: string | null): void {
  const socket = useSocketStore((s) => s.socket);
  const didSendRef = useRef(false);

  useEffect(() => {
    if (!socket || !sessionId) return;
    didSendRef.current = false;

    socket.emit("chat:join", sessionId);

    function handleTurnStart(): void {
      const ss = useChatStore.getState().getSessionState(sessionId!);
      if (ss.isStreaming) {
        useChatStore.getState().finalizeAssistantMessage(sessionId!);
      }
      onSessionTurnStart(sessionId!);
      useChatStore.getState().appendMessage(sessionId!, createStreamingAssistantMessage());
    }

    function ensureStreamingState(): void {
      const ss = useChatStore.getState().getSessionState(sessionId!);
      if (!ss.isStreaming) {
        onSessionTurnStart(sessionId!);
        const msgs = useChatStore.getState().messages.get(sessionId!);
        const last = msgs?.[msgs.length - 1];
        if (!last || last.role !== "assistant" || !last.isStreaming) {
          useChatStore.getState().appendMessage(sessionId!, createStreamingAssistantMessage());
        }
      }
    }

    function handleMessageDelta(data: { delta: string }): void {
      ensureStreamingState();
      onSessionMessageDelta(sessionId!, data.delta);
    }

    function handleReasoningDelta(data: { delta: string; tokens?: number }): void {
      ensureStreamingState();
      onSessionReasoningDelta(sessionId!, data.delta);
      if (data.tokens !== undefined) {
        useChatStore.getState().updateSessionState(sessionId!, {
          streamingReasoningTokens: data.tokens,
        });
      }
    }

    let messageFallback: string | undefined;

    function handleMessage(data: { content: string }): void {
      messageFallback = data.content;
    }

    function handleTurnEnd(): void {
      useChatStore.getState().finalizeAssistantMessage(sessionId!, messageFallback);
      messageFallback = undefined;
    }

    function handleIdle(): void {
      useChatStore.getState().clearSessionStreamingState(sessionId!);
    }

    function handleError(data: { message: string }): void {
      useChatStore.setState({ sessionError: data.message });
      useChatStore.getState().appendMessage(sessionId!, createErrorMessage(data.message));
      useChatStore.getState().clearSessionStreamingState(sessionId!);
    }

    function handleTitleChanged(data: { title: string }): void {
      useChatStore.getState().renameSession(sessionId!, data.title);
    }

    function handleUsage(data: { contextWindowPct: number }): void {
      useChatStore.getState().updateSessionState(sessionId!, {
        contextWindowPct: data.contextWindowPct,
      });
    }

    function handleCompactionStart(): void {
      useChatStore.getState().appendMessage(sessionId!, createCompactionStartMessage());
    }

    function handleCompactionComplete(data: { tokensRemoved: number; summary?: string }): void {
      useChatStore.setState(buildCompactionCompleteUpdate(sessionId!, data));
    }

    function handleToolStart(data: { toolCallId: string; roundId: string; toolName: string; toolArgs?: Record<string, unknown> }): void {
      useChatStore.setState(paneToolStartUpdate(sessionId!, data));
    }

    function handleToolComplete(data: { toolCallId: string; toolName?: string; result?: Record<string, unknown>; success?: boolean; error?: unknown }): void {
      useChatStore.setState(paneToolCompleteUpdate(sessionId!, data));
    }

    function handleSubagentStart(data: { toolCallId: string; agentName: string; agentDisplayName?: string }): void {
      useChatStore.setState(paneSubagentStartUpdate(sessionId!, data));
    }

    function handleSubagentComplete(data: { toolCallId: string }): void {
      useChatStore.setState(paneSubagentCompleteUpdate(sessionId!, data));
    }

    function handlePermission(data: { requestId: string; title: string; message: string; permissionKind: string; diff?: string }): void {
      if (useChatStore.getState().autopilot) {
        useChatStore.getState().respondToPermission(data.requestId, true);
        return;
      }
      useChatStore.getState().updateSessionState(sessionId!, { pendingPermission: data });
      if (useChatStore.getState().activeSessionId === sessionId) {
        useChatStore.setState({ pendingPermission: data });
      }
    }

    function handleInput(data: { requestId: string; prompt: string }): void {
      useChatStore.getState().updateSessionState(sessionId!, { pendingInput: data });
      if (useChatStore.getState().activeSessionId === sessionId) {
        useChatStore.setState({ pendingInput: data });
      }
    }

    function handleElicitation(data: { requestId: string; schema: Record<string, unknown>; message?: string }): void {
      useChatStore.getState().updateSessionState(sessionId!, { pendingElicitation: data });
      if (useChatStore.getState().activeSessionId === sessionId) {
        useChatStore.setState({ pendingElicitation: data });
      }
    }

    socket.on("turn-start", handleTurnStart);
    socket.on("message-delta", handleMessageDelta);
    socket.on("reasoning-delta", handleReasoningDelta);
    socket.on("message", handleMessage);
    socket.on("turn-end", handleTurnEnd);
    socket.on("idle", handleIdle);
    socket.on("error", handleError);
    socket.on("title-changed", handleTitleChanged);
    socket.on("usage", handleUsage);
    socket.on("compaction-start", handleCompactionStart);
    socket.on("compaction-complete", handleCompactionComplete);
    socket.on("tool-start", handleToolStart);
    socket.on("tool-complete", handleToolComplete);
    socket.on("subagent-start", handleSubagentStart);
    socket.on("subagent-complete", handleSubagentComplete);
    socket.on("permission-request", handlePermission);
    socket.on("input-request", handleInput);
    socket.on("elicitation-request", handleElicitation);

    document.addEventListener("visibilitychange", onVisibilityChange);

    // Handle pending initial message
    const paneKey = `${paneId}:${sessionId}`;
    const pending = useChatStore.getState().pendingInitialMessage;
    if (pending && !sentPendingPanes.has(paneKey)) {
      sentPendingPanes.add(paneKey);
      useChatStore.setState({ pendingInitialMessage: null });
      useChatStore.getState().sendMessageToSession(sessionId, pending);
      didSendRef.current = true;
    }

    return () => {
      socket.emit("chat:leave", sessionId);
      socket.off("turn-start", handleTurnStart);
      socket.off("message-delta", handleMessageDelta);
      socket.off("reasoning-delta", handleReasoningDelta);
      socket.off("message", handleMessage);
      socket.off("turn-end", handleTurnEnd);
      socket.off("idle", handleIdle);
      socket.off("error", handleError);
      socket.off("title-changed", handleTitleChanged);
      socket.off("usage", handleUsage);
      socket.off("compaction-start", handleCompactionStart);
      socket.off("compaction-complete", handleCompactionComplete);
      socket.off("tool-start", handleToolStart);
      socket.off("tool-complete", handleToolComplete);
      socket.off("subagent-start", handleSubagentStart);
      socket.off("subagent-complete", handleSubagentComplete);
      socket.off("permission-request", handlePermission);
      socket.off("input-request", handleInput);
      socket.off("elicitation-request", handleElicitation);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (!didSendRef.current) {
        useChatStore.getState().clearSessionStreamingState(sessionId);
      }
    };
  }, [socket, paneId, sessionId]);
}

// ---------------------------------------------------------------------------
// ChatPane component
// ---------------------------------------------------------------------------

interface ChatPaneProps {
  paneId: string;
  sessionId: string | null;
  isFocused: boolean;
  canClose: boolean;
  onFocus: () => void;
  onClose: () => void;
  onSessionChange: (sessionId: string) => void;
}

export function ChatPane({
  paneId,
  sessionId,
  isFocused,
  canClose,
  onFocus,
  onClose,
  onSessionChange,
}: ChatPaneProps) {
  const { projectId } = useParams<{ projectId: string }>();
  const bridgeStatus = useChatStore((s) => s.bridgeStatus);
  const createSession = useChatStore((s) => s.createSession);

  // Read per-session state
  const ss = useChatStore((s) =>
    sessionId ? s.sessionStates.get(sessionId) ?? createDefaultSessionState() : createDefaultSessionState(),
  );

  // Bind socket events for this pane's session
  usePaneSocket(paneId, sessionId);

  // Resume session when assigned
  useEffect(() => {
    if (projectId && sessionId && bridgeStatus === "ready") {
      useChatStore.getState().resumeSession(projectId, sessionId);
    }
  }, [projectId, sessionId, bridgeStatus]);

  const handleNewSession = useCallback(async () => {
    if (!projectId) return;
    const newId = await createSession(projectId);
    if (newId) onSessionChange(newId);
  }, [projectId, createSession, onSessionChange]);

  return (
    <div
      className="flex flex-col h-full min-h-0"
      onClick={onFocus}
    >
      <ChatPaneHeader
        paneId={paneId}
        sessionId={sessionId}
        isFocused={isFocused}
        canClose={canClose}
        isStreaming={ss.isStreaming}
        hasPendingPermission={ss.pendingPermission !== null}
        onFocus={onFocus}
        onClose={onClose}
        onSessionChange={onSessionChange}
        onNewSession={handleNewSession}
      />

      {sessionId && bridgeStatus === "ready" ? (
        <>
          <ChatContextBar />
          <ChatMessageList sessionId={sessionId} />
          {ss.pendingPermission && (
            <div className="px-2 pb-2">
              <ChatPermissionBanner key={ss.pendingPermission.requestId} request={ss.pendingPermission} />
            </div>
          )}
          {ss.pendingInput && (
            <div className="px-2 pb-2">
              <ChatInputDialog request={ss.pendingInput} />
            </div>
          )}
          {ss.pendingElicitation && (
            <div className="px-2 pb-2">
              <ChatElicitationDialog request={ss.pendingElicitation} />
            </div>
          )}
          <ChatInput />
        </>
      ) : (
        <ChatSessionPickerDialog
          onSelect={onSessionChange}
          onCreateNew={handleNewSession}
        />
      )}
    </div>
  );
}
