import { useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import { useChatStore, type ChatState, onMessageDelta, onReasoningDelta, onTurnStart, onVisibilityChange } from "../stores/chat-store";
import { uuid } from "../lib/utils";
import { useSocketStore } from "../api/socket";
import { ChatSessionList } from "../components/chat/ChatSessionList";
import { ChatMessageList } from "../components/chat/ChatMessageList";
import { ChatInput } from "../components/chat/ChatInput";
import { ChatModelSelector } from "../components/chat/ChatModelSelector";
import { ToolDisplayModeSelector } from "../components/chat/ToolDisplayModeSelector";
import { ChatEmptyState } from "../components/chat/ChatEmptyState";
import { ChatContextBar } from "../components/chat/ChatContextBar";
import { ChatPermissionBanner } from "../components/chat/ChatPermissionBanner";
import { ChatInputDialog } from "../components/chat/ChatInputDialog";
import { ChatElicitationDialog } from "../components/chat/ChatElicitationDialog";
import type { ChatMessage, ContentBlock } from "../types/chat";

// ---------------------------------------------------------------------------
// Top-level stable selectors (avoid inline arrow fns that create new refs)
// ---------------------------------------------------------------------------

const selectBridgeStatus = (s: ChatState) => s.bridgeStatus;
const selectSessions = (s: ChatState) => s.sessions;
const selectSessionsFetched = (s: ChatState) => s.sessionsFetched;
const selectSessionError = (s: ChatState) => s.sessionError;
const selectPendingPermission = (s: ChatState) => s.pendingPermission;
const selectPendingInput = (s: ChatState) => s.pendingInput;
const selectPendingElicitation = (s: ChatState) => s.pendingElicitation;
const selectIsStreaming = (s: ChatState) => s.isStreaming;
const selectCheckBridgeStatus = (s: ChatState) => s.checkBridgeStatus;
const selectFetchModels = (s: ChatState) => s.fetchModels;
const selectFetchSessions = (s: ChatState) => s.fetchSessions;
const selectSetActiveSession = (s: ChatState) => s.setActiveSession;
const selectResumeSession = (s: ChatState) => s.resumeSession;

// ---------------------------------------------------------------------------
// Module-level helpers to avoid deep function nesting in effect handlers
// ---------------------------------------------------------------------------

function updateSessionTitle(s: ChatState, sessionId: string, title: string): Partial<ChatState> {
  return {
    sessions: s.sessions.map((sess) =>
      sess.id === sessionId ? { ...sess, title } : sess,
    ),
  };
}

function replaceCompactionBlock(
  s: ChatState,
  sessionId: string,
  compactionBlock: ContentBlock,
): Partial<ChatState> {
  const next = new Map(s.messages);
  const msgs = next.get(sessionId);
  if (!msgs) return {};
  const updated = msgs.map((m) =>
    m.blocks.length === 1 && m.blocks[0]?.type === "compaction" && m.blocks[0].tokensRemoved === 0
      ? { ...m, blocks: [compactionBlock] }
      : m,
  );
  next.set(sessionId, updated);
  return { messages: next };
}

// ---------------------------------------------------------------------------
// Socket.IO chat event binding
// ---------------------------------------------------------------------------

// Tracks sessions that have already had their pending initial message sent.
// Prevents duplicate sends when React Strict Mode double-fires effects.
const sentPendingSessions = new Set<string>();

function useChatSocket(sessionId: string | null): void {
  const socket = useSocketStore((s) => s.socket);
  // Track whether THIS effect instance initiated a send, so the cleanup
  // avoids clearing streaming state that belongs to an active generation.
  const didSendRef = useRef(false);

  useEffect(() => {
    if (!socket || !sessionId) return;
    didSendRef.current = false;

    socket.emit("chat:join", sessionId);

    function handleTurnStart(): void {
      // The bridge suppresses duplicate turn-starts server-side via
      // suppressNextTurnStart. If we still receive one while streaming,
      // it's a legitimate new turn (e.g., tool-use → re-prompt).
      // Finalize the previous turn's content before starting a new one.
      if (useChatStore.getState().isStreaming && sessionId) {
        useChatStore.getState().finalizeAssistantMessage(sessionId);
      }

      onTurnStart();
      if (sessionId) {
        const msg: ChatMessage = {
          id: uuid(),
          role: "assistant",
          blocks: [],
          timestamp: new Date().toISOString(),
          isStreaming: true,
        };
        useChatStore.getState().appendMessage(sessionId, msg);
      }
    }

    function ensureStreamingState(): void {
      // Self-healing: if a delta arrives but isStreaming is false (e.g.,
      // turn-start was missed due to Strict Mode cleanup/remount), recover.
      if (!useChatStore.getState().isStreaming) {
        onTurnStart();
        if (sessionId) {
          const msgs = useChatStore.getState().messages.get(sessionId);
          const last = msgs?.[msgs.length - 1];
          if (!last || last.role !== "assistant" || !last.isStreaming) {
            useChatStore.getState().appendMessage(sessionId, {
              id: uuid(),
              role: "assistant",
              blocks: [],
              timestamp: new Date().toISOString(),
              isStreaming: true,
            });
          }
        }
      }
    }

    function handleMessageDelta(data: { delta: string }): void {
      ensureStreamingState();
      onMessageDelta(data.delta);
    }

    function handleReasoningDelta(data: { delta: string; tokens?: number }): void {
      ensureStreamingState();
      onReasoningDelta(data.delta);
      if (data.tokens !== undefined) {
        useChatStore.setState({ streamingReasoningTokens: data.tokens });
      }
    }

    // Stash the full content from assistant.message so turn-end can use it
    // as a fallback. We do NOT finalize here — finalizing immediately would
    // prevent streaming deltas from ever rendering (the RAF hasn't flushed yet).
    let messageFallback: string | undefined;

    function handleMessage(data: { content: string }): void {
      messageFallback = data.content;
    }

    function handleTurnEnd(): void {
      if (!sessionId) return;
      useChatStore.getState().finalizeAssistantMessage(sessionId, messageFallback);
      messageFallback = undefined;
    }

    function handleIdle(): void {
      useChatStore.getState().clearStreamingState();
    }

    function handleError(data: { message: string }): void {
      if (!sessionId) return;
      useChatStore.setState({ sessionError: data.message });
      const block: ContentBlock = { type: "warning", message: data.message };
      useChatStore.getState().appendMessage(sessionId, {
        id: uuid(),
        role: "system",
        blocks: [block],
        timestamp: new Date().toISOString(),
        isStreaming: false,
      });
      useChatStore.getState().clearStreamingState();
    }

    function handleTitleChanged(data: { title: string }): void {
      useChatStore.setState((s) => updateSessionTitle(s, sessionId!, data.title));
    }

    function handleUsage(data: { contextWindowPct: number }): void {
      useChatStore.setState({ contextWindowPct: data.contextWindowPct });
    }

    function handleCompactionStart(): void {
      if (!sessionId) return;
      const block: ContentBlock = { type: "compaction", tokensRemoved: 0, summary: "Compacting..." };
      useChatStore.getState().appendMessage(sessionId, {
        id: `compaction-${Date.now()}`,
        role: "system",
        blocks: [block],
        timestamp: new Date().toISOString(),
        isStreaming: false,
      });
    }

    function handleCompactionComplete(data: { tokensRemoved: number; summary?: string }): void {
      if (!sessionId) return;
      const block: ContentBlock = {
        type: "compaction",
        tokensRemoved: data.tokensRemoved,
        ...(data.summary ? { summary: data.summary } : {}),
      };
      useChatStore.setState((s) => replaceCompactionBlock(s, sessionId, block));
    }

    // Tool events — inject ToolExecutionBlock into last assistant message
    function handleToolStart(data: { toolCallId: string; roundId: string; toolName: string; toolArgs?: Record<string, unknown> }): void {
      if (!sessionId) return;
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
        const tools = new Map(s.activeTools);
        tools.set(data.toolCallId, { ...data, status: "running", startedAt: Date.now() });

        const msgs = new Map(s.messages);
        const list = msgs.get(sessionId!) ?? [];
        const last = list[list.length - 1];
        if (last?.role === "assistant") {
          const updated = { ...last, blocks: [...last.blocks, block] };
          msgs.set(sessionId!, [...list.slice(0, -1), updated]);
        }
        return { activeTools: tools, messages: msgs };
      });
    }

    function handleToolComplete(data: { toolCallId: string; toolName?: string; result?: Record<string, unknown>; success?: boolean; error?: unknown }): void {
      if (!sessionId) return;
      useChatStore.setState((s) => {
        const tools = new Map(s.activeTools);
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
          const oldBlock = msg.blocks[blockIdx] as import("../types/chat").ToolExecutionBlock;
          const resultObj = data.result ?? {};
          // Extract content string: prefer .content if it's a string, else JSON-serialize
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
        return { activeTools: tools, messages: msgs };
      });
    }

    // Subagent events — inject SubagentBlock into last assistant message
    function handleSubagentStart(data: { toolCallId: string; agentName: string; agentDisplayName?: string }): void {
      if (!sessionId) return;
      const block: ContentBlock = {
        type: "subagent",
        toolCallId: data.toolCallId,
        agentName: data.agentName,
        agentDisplayName: data.agentDisplayName ?? data.agentName,
        status: "running",
      };
      useChatStore.setState((s) => {
        const subs = new Map(s.activeSubagents);
        subs.set(data.toolCallId, { ...data, status: "running", startedAt: Date.now() });

        const msgs = new Map(s.messages);
        const list = msgs.get(sessionId!) ?? [];
        const last = list[list.length - 1];
        if (last?.role === "assistant") {
          const updated = { ...last, blocks: [...last.blocks, block] };
          msgs.set(sessionId!, [...list.slice(0, -1), updated]);
        }
        return { activeSubagents: subs, messages: msgs };
      });
    }

    function handleSubagentComplete(data: { toolCallId: string }): void {
      if (!sessionId) return;
      useChatStore.setState((s) => {
        const subs = new Map(s.activeSubagents);
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
          const oldBlock = msg.blocks[blockIdx] as import("../types/chat").SubagentBlock;
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
        return { activeSubagents: subs, messages: msgs };
      });
    }

    // Permission/input/elicitation — set pending state (Phase 6 renders dialogs)
    function handlePermission(data: { requestId: string; title: string; message: string; permissionKind: string; diff?: string }): void {
      if (useChatStore.getState().autopilot) {
        useChatStore.getState().respondToPermission(data.requestId, true);
        return;
      }
      useChatStore.setState({ pendingPermission: data });
    }

    function handleInput(data: { requestId: string; prompt: string }): void {
      useChatStore.setState({ pendingInput: data });
    }

    function handleElicitation(data: { requestId: string; schema: Record<string, unknown>; message?: string }): void {
      useChatStore.setState({ pendingElicitation: data });
    }

    // Bind events
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

    // Visibility change listener for buffer flushing
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Send pending initial message if present (from new session creation).
    // Use sentPendingSessions to deduplicate across Strict Mode double-effects.
    const pending = useChatStore.getState().pendingInitialMessage;
    if (pending && !sentPendingSessions.has(sessionId)) {
      sentPendingSessions.add(sessionId);
      useChatStore.setState({ pendingInitialMessage: null });
      useChatStore.getState().sendMessage(pending);
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
      // Don't clear streaming state if we just sent a message — Strict Mode
      // cleanup would wipe the streaming state that the server is about to fill.
      if (!didSendRef.current) {
        useChatStore.getState().clearStreamingState();
      }
    };
  }, [socket, sessionId]);
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts — scoped to the chat page
// ---------------------------------------------------------------------------

interface ShortcutEntry {
  match: (e: KeyboardEvent) => boolean;
  handler: (e: KeyboardEvent) => void;
}

function isInputTarget(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement).tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

function useChatKeyboardShortcuts(projectId: string | undefined): void {
  const navigate = useNavigate();
  const isStreaming = useChatStore(selectIsStreaming);

  const copyLastAssistantMessage = useCallback(() => {
    const { activeSessionId: sid, messages } = useChatStore.getState();
    if (!sid) return;
    const msgs = messages.get(sid);
    if (!msgs) return;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m?.role === "assistant") {
        const text = m.blocks
          .filter((b): b is { type: "text"; content: string } => b.type === "text")
          .map((b) => b.content)
          .join("\n\n");
        if (text) navigator.clipboard.writeText(text);
        return;
      }
    }
  }, []);

  const reviseLastUserMessage = useCallback(() => {
    const { activeSessionId: sid, messages, reviseTo } = useChatStore.getState();
    if (!sid) return;
    const msgs = messages.get(sid);
    if (!msgs) return;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]?.role === "user") {
        reviseTo(i);
        return;
      }
    }
  }, []);

  const shortcuts: ShortcutEntry[] = useMemo(() => [
    // Escape — cancel streaming
    {
      match: (e) => e.key === "Escape" && isStreaming,
      handler: (e) => {
        e.preventDefault();
        useChatStore.getState().cancelGeneration();
      },
    },
    // Ctrl/Cmd+N — new session
    {
      match: (e) => (e.metaKey || e.ctrlKey) && e.key === "n" && !e.shiftKey,
      handler: (e) => {
        e.preventDefault();
        if (projectId) {
          useChatStore.setState({ activeSessionId: null });
          navigate(`/${projectId}/chat`);
        }
      },
    },
    // Ctrl/Cmd+Shift+C — copy last assistant message
    {
      match: (e) => (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "C",
      handler: (e) => {
        e.preventDefault();
        copyLastAssistantMessage();
      },
    },
    // Up arrow — revise last user message (only when input is focused and empty)
    {
      match: (e) => e.key === "ArrowUp" && isInputTarget(e) && (e.target as HTMLTextAreaElement).value === "",
      handler: (e) => {
        e.preventDefault();
        reviseLastUserMessage();
      },
    },
  ], [isStreaming, projectId, navigate, copyLastAssistantMessage, reviseLastUserMessage]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      for (const shortcut of shortcuts) {
        if (shortcut.match(e)) {
          shortcut.handler(e);
          return;
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);
}

// ---------------------------------------------------------------------------
// Chat page — two-panel layout
// ---------------------------------------------------------------------------

export default function ChatPage() {
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId?: string }>();
  const navigate = useNavigate();
  const bridgeStatus = useChatStore(selectBridgeStatus);
  const sessions = useChatStore(selectSessions);
  const sessionsFetched = useChatStore(selectSessionsFetched);
  const sessionError = useChatStore(selectSessionError);
  const pendingPermission = useChatStore(selectPendingPermission);
  const pendingInput = useChatStore(selectPendingInput);
  const pendingElicitation = useChatStore(selectPendingElicitation);
  const checkBridgeStatus = useChatStore(selectCheckBridgeStatus);
  const fetchModels = useChatStore(selectFetchModels);
  const fetchSessions = useChatStore(selectFetchSessions);
  const setActiveSession = useChatStore(selectSetActiveSession);
  const resumeSession = useChatStore(selectResumeSession);

  // Fetch bridge status — retry while not ready (bridge initializes lazily)
  useEffect(() => {
    checkBridgeStatus();
  }, [checkBridgeStatus]);

  useEffect(() => {
    if (bridgeStatus === "ready" || bridgeStatus === "error" || bridgeStatus === "unavailable") return;
    const timer = setInterval(checkBridgeStatus, 2000);
    return () => clearInterval(timer);
  }, [bridgeStatus, checkBridgeStatus]);

  useEffect(() => {
    if (bridgeStatus === "ready") {
      fetchModels();
    }
  }, [bridgeStatus, fetchModels]);

  useEffect(() => {
    if (projectId && bridgeStatus === "ready") {
      fetchSessions(projectId);
    }
  }, [projectId, bridgeStatus, fetchSessions]);

  // Sync route param to store and load messages for the session
  useEffect(() => {
    setActiveSession(sessionId ?? null);
    if (projectId && sessionId && bridgeStatus === "ready") {
      resumeSession(projectId, sessionId);
    }
  }, [sessionId, projectId, bridgeStatus, setActiveSession, resumeSession]);

  // Bind socket events for active session
  useChatSocket(sessionId ?? null);

  // Register keyboard shortcuts
  useChatKeyboardShortcuts(projectId);

  const sessionsLoading = bridgeStatus === "ready" && !sessionsFetched;
  const showBridgeNotReady = bridgeStatus !== "ready";

  return (
    <div className="flex h-full -m-4 md:-m-6">
      {/* Session list panel — hidden on mobile when a session is active */}
      <div className={`${sessionId ? "hidden md:block" : "w-full md:w-[280px]"} md:w-[280px] flex-shrink-0 border-r border-border bg-background overflow-hidden`}>
        <ChatSessionList loading={sessionsLoading && !showBridgeNotReady} />
      </div>

      {/* Chat area */}
      <div className={`flex-1 flex flex-col min-w-0 ${sessionId ? "" : "hidden md:flex"}`}>
        {sessionId && bridgeStatus === "ready" ? (
          <>
            <div className="flex items-center gap-2 px-2 md:px-4 py-2 border-b border-border overflow-x-auto">
              {/* Mobile back button */}
              <button
                onClick={() => navigate(`/${projectId}/chat`)}
                className="md:hidden flex-shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Back to sessions"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <ChatModelSelector />
              <ToolDisplayModeSelector />
            </div>
            <ChatContextBar />
            <ChatMessageList sessionId={sessionId} />
            {pendingPermission && (
              <div className="px-2 md:px-4 pb-2">
                <ChatPermissionBanner key={pendingPermission.requestId} request={pendingPermission} />
              </div>
            )}
            {pendingInput && (
              <div className="px-2 md:px-4 pb-2">
                <ChatInputDialog request={pendingInput} />
              </div>
            )}
            {pendingElicitation && (
              <div className="px-2 md:px-4 pb-2">
                <ChatElicitationDialog request={pendingElicitation} />
              </div>
            )}
            <ChatInput />
          </>
        ) : (
          <ChatEmptyState sessionError={sessionError ?? undefined} />
        )}
      </div>
    </div>
  );
}
