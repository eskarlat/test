/**
 * ChatPane — independent session pane with its own socket room, input, and streaming.
 * ADR-052 §2.2
 *
 * Each pane joins/leaves its session's Socket.IO room independently and
 * renders its own ChatMessageList, ChatInput, permission dialogs, etc.
 */

import { useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
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
import { uuid } from "../../lib/utils";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";
import { ChatContextBar } from "./ChatContextBar";
import { ChatPermissionBanner } from "./ChatPermissionBanner";
import { ChatInputDialog } from "./ChatInputDialog";
import { ChatElicitationDialog } from "./ChatElicitationDialog";
import { ChatPaneHeader } from "./ChatPaneHeader";
import { ChatSessionPickerDialog } from "./ChatSessionPickerDialog";
import type { ChatMessage, ContentBlock } from "../../types/chat";

// ---------------------------------------------------------------------------
// Deduplication tracker for pending initial messages
// ---------------------------------------------------------------------------

const sentPendingPanes = new Set<string>();

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
      const msg: ChatMessage = {
        id: uuid(),
        role: "assistant",
        blocks: [],
        timestamp: new Date().toISOString(),
        isStreaming: true,
      };
      useChatStore.getState().appendMessage(sessionId!, msg);
    }

    function ensureStreamingState(): void {
      const ss = useChatStore.getState().getSessionState(sessionId!);
      if (!ss.isStreaming) {
        onSessionTurnStart(sessionId!);
        const msgs = useChatStore.getState().messages.get(sessionId!);
        const last = msgs?.[msgs.length - 1];
        if (!last || last.role !== "assistant" || !last.isStreaming) {
          useChatStore.getState().appendMessage(sessionId!, {
            id: uuid(),
            role: "assistant",
            blocks: [],
            timestamp: new Date().toISOString(),
            isStreaming: true,
          });
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
      const block: ContentBlock = { type: "warning", message: data.message };
      useChatStore.getState().appendMessage(sessionId!, {
        id: uuid(),
        role: "system",
        blocks: [block],
        timestamp: new Date().toISOString(),
        isStreaming: false,
      });
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
      const block: ContentBlock = { type: "compaction", tokensRemoved: 0, summary: "Compacting..." };
      useChatStore.getState().appendMessage(sessionId!, {
        id: `compaction-${Date.now()}`,
        role: "system",
        blocks: [block],
        timestamp: new Date().toISOString(),
        isStreaming: false,
      });
    }

    function handleCompactionComplete(data: { tokensRemoved: number; summary?: string }): void {
      const block: ContentBlock = {
        type: "compaction",
        tokensRemoved: data.tokensRemoved,
        ...(data.summary ? { summary: data.summary } : {}),
      };
      useChatStore.setState((s) => {
        const next = new Map(s.messages);
        const msgs = next.get(sessionId!);
        if (!msgs) return {};
        const updated = msgs.map((m) =>
          m.blocks.length === 1 && m.blocks[0]?.type === "compaction" && m.blocks[0].tokensRemoved === 0
            ? { ...m, blocks: [block] }
            : m,
        );
        next.set(sessionId!, updated);
        return { messages: next };
      });
    }

    function handleToolStart(data: { toolCallId: string; roundId: string; toolName: string; toolArgs?: Record<string, unknown> }): void {
      const block: ContentBlock = {
        type: "tool-execution",
        toolCallId: data.toolCallId,
        roundId: data.roundId,
        toolName: data.toolName,
        arguments: data.toolArgs ?? {},
        status: "running",
        isHistorical: false,
      };
      useChatStore.setState((s) => {
        const ss = s.sessionStates.get(sessionId!) ?? createDefaultSessionState();
        const tools = new Map(ss.activeTools);
        tools.set(data.toolCallId, { ...data, status: "running", startedAt: Date.now() });

        const msgs = new Map(s.messages);
        const list = msgs.get(sessionId!) ?? [];
        const last = list[list.length - 1];
        if (last?.role === "assistant") {
          const updated = { ...last, blocks: [...last.blocks, block] };
          msgs.set(sessionId!, [...list.slice(0, -1), updated]);
        }
        const newStates = new Map(s.sessionStates);
        newStates.set(sessionId!, { ...ss, activeTools: tools });
        const topLevel: Partial<ChatState> = { messages: msgs, sessionStates: newStates };
        if (s.activeSessionId === sessionId) topLevel.activeTools = tools;
        return topLevel;
      });
    }

    function handleToolComplete(data: { toolCallId: string; toolName?: string; result?: Record<string, unknown>; success?: boolean; error?: unknown }): void {
      useChatStore.setState((s) => {
        const ss = s.sessionStates.get(sessionId!) ?? createDefaultSessionState();
        const tools = new Map(ss.activeTools);
        const tracked = tools.get(data.toolCallId);
        const duration = tracked ? Date.now() - tracked.startedAt : undefined;
        tools.delete(data.toolCallId);

        const msgs = new Map(s.messages);
        const list = msgs.get(sessionId!) ?? [];
        const updatedList = list.map((msg) => {
          if (msg.role !== "assistant") return msg;
          const blockIdx = msg.blocks.findIndex(
            (b) => b.type === "tool-execution" && b.toolCallId === data.toolCallId,
          );
          if (blockIdx < 0) return msg;
          const oldBlock = msg.blocks[blockIdx] as import("../../types/chat").ToolExecutionBlock;
          const resultObj = data.result ?? {};
          const resultContent = typeof resultObj === "object" && resultObj !== null && "content" in resultObj && typeof (resultObj as Record<string, unknown>).content === "string"
            ? (resultObj as Record<string, unknown>).content as string
            : JSON.stringify(resultObj, null, 2);
          const errorStr = data.error
            ? (typeof data.error === "object" ? JSON.stringify(data.error) : String(data.error))
            : undefined;
          const newBlock: ContentBlock = {
            ...oldBlock,
            status: data.success === false ? "error" : "complete",
            result: { content: resultContent },
            ...(errorStr ? { error: errorStr } : {}),
            ...(duration != null ? { duration } : {}),
          };
          const blocks = [...msg.blocks];
          blocks[blockIdx] = newBlock;
          return { ...msg, blocks };
        });
        msgs.set(sessionId!, updatedList);

        const newStates = new Map(s.sessionStates);
        newStates.set(sessionId!, { ...ss, activeTools: tools });
        const topLevel: Partial<ChatState> = { messages: msgs, sessionStates: newStates };
        if (s.activeSessionId === sessionId) topLevel.activeTools = tools;
        return topLevel;
      });
    }

    function handleSubagentStart(data: { toolCallId: string; agentName: string; agentDisplayName?: string }): void {
      const block: ContentBlock = {
        type: "subagent",
        toolCallId: data.toolCallId,
        agentName: data.agentName,
        agentDisplayName: data.agentDisplayName ?? data.agentName,
        status: "running",
      };
      useChatStore.setState((s) => {
        const ss = s.sessionStates.get(sessionId!) ?? createDefaultSessionState();
        const subs = new Map(ss.activeSubagents);
        subs.set(data.toolCallId, { ...data, status: "running", startedAt: Date.now() });

        const msgs = new Map(s.messages);
        const list = msgs.get(sessionId!) ?? [];
        const last = list[list.length - 1];
        if (last?.role === "assistant") {
          const updated = { ...last, blocks: [...last.blocks, block] };
          msgs.set(sessionId!, [...list.slice(0, -1), updated]);
        }
        const newStates = new Map(s.sessionStates);
        newStates.set(sessionId!, { ...ss, activeSubagents: subs });
        const topLevel: Partial<ChatState> = { messages: msgs, sessionStates: newStates };
        if (s.activeSessionId === sessionId) topLevel.activeSubagents = subs;
        return topLevel;
      });
    }

    function handleSubagentComplete(data: { toolCallId: string }): void {
      useChatStore.setState((s) => {
        const ss = s.sessionStates.get(sessionId!) ?? createDefaultSessionState();
        const subs = new Map(ss.activeSubagents);
        const tracked = subs.get(data.toolCallId);
        const duration = tracked ? Date.now() - tracked.startedAt : undefined;
        subs.delete(data.toolCallId);

        const msgs = new Map(s.messages);
        const list = msgs.get(sessionId!) ?? [];
        const updatedList = list.map((msg) => {
          if (msg.role !== "assistant") return msg;
          const blockIdx = msg.blocks.findIndex(
            (b) => b.type === "subagent" && b.toolCallId === data.toolCallId,
          );
          if (blockIdx < 0) return msg;
          const oldBlock = msg.blocks[blockIdx] as import("../../types/chat").SubagentBlock;
          const newBlock: ContentBlock = {
            ...oldBlock,
            status: "complete",
            ...(duration != null ? { duration } : {}),
          };
          const blocks = [...msg.blocks];
          blocks[blockIdx] = newBlock;
          return { ...msg, blocks };
        });
        msgs.set(sessionId!, updatedList);

        const newStates = new Map(s.sessionStates);
        newStates.set(sessionId!, { ...ss, activeSubagents: subs });
        const topLevel: Partial<ChatState> = { messages: msgs, sessionStates: newStates };
        if (s.activeSessionId === sessionId) topLevel.activeSubagents = subs;
        return topLevel;
      });
    }

    function handlePermission(data: { requestId: string; title: string; message: string; permissionKind: string; diff?: string }): void {
      if (useChatStore.getState().autopilot) {
        useChatStore.getState().respondToPermission(data.requestId, true);
        return;
      }
      useChatStore.getState().updateSessionState(sessionId!, { pendingPermission: data });
      // Also set top-level for backward compat
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
  const navigate = useNavigate();
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
