import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useChatStore, type ChatState, onMessageDelta, onReasoningDelta, onTurnStart, onVisibilityChange } from "../stores/chat-store";
import { useChatLayoutStore, countLeaves, collectPaneIds, type SplitDirection } from "../stores/chat-layout-store";
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
import { ChatLayoutRenderer } from "../components/chat/ChatLayoutRenderer";
import { SplitMenu } from "../components/chat/SplitMenu";
import type { ChatMessage, ContentBlock } from "../types/chat";

// ---------------------------------------------------------------------------
// Top-level stable selectors (avoid inline arrow fns that create new refs)
// ---------------------------------------------------------------------------

const selectBridgeStatus = (s: ChatState) => s.bridgeStatus;
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
// Socket.IO chat event binding (legacy single-session — used when layout is
// single-pane for backward compat with existing behavior)
// ---------------------------------------------------------------------------

const sentPendingSessions = new Set<string>();

function useChatSocket(sessionId: string | null): void {
  const socket = useSocketStore((s) => s.socket);
  const didSendRef = useRef(false);

  useEffect(() => {
    if (!socket || !sessionId) return;
    didSendRef.current = false;

    socket.emit("chat:join", sessionId);

    function handleTurnStart(): void {
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
      if (!didSendRef.current) {
        useChatStore.getState().clearStreamingState();
      }
    };
  }, [socket, sessionId]);
}

// ---------------------------------------------------------------------------
// Responsive breakpoints hook (ADR-052 §2.9)
// ---------------------------------------------------------------------------

function useMaxPanes(): number {
  const [maxPanes, setMaxPanes] = useState(() => {
    if (typeof window === "undefined") return 4;
    if (window.innerWidth < 768) return 1;
    if (window.innerWidth <= 1200) return 2;
    return 4;
  });

  useEffect(() => {
    function handleResize() {
      const w = window.innerWidth;
      if (w < 768) setMaxPanes(1);
      else if (w <= 1200) setMaxPanes(2);
      else setMaxPanes(4);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return maxPanes;
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts — scoped to the chat page (ADR-052 §2.8 + legacy)
// ---------------------------------------------------------------------------

interface ShortcutEntry {
  match: (e: KeyboardEvent) => boolean;
  handler: (e: KeyboardEvent) => void;
}

function isInputTarget(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement).tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function useChatKeyboardShortcuts(
  projectId: string | undefined,
  splitActions: {
    splitRight: () => void;
    splitDown: () => void;
    closePane: () => void;
    focusPaneByIndex: (index: number) => void;
    cycleFocus: (delta: number) => void;
    paneCount: number;
  },
): void {
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
    // Ctrl+\ — Split right (ADR-052 §2.8)
    {
      match: (e) => (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "\\",
      handler: (e) => {
        e.preventDefault();
        splitActions.splitRight();
      },
    },
    // Ctrl+Shift+\ — Split down (ADR-052 §2.8)
    {
      match: (e) => (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "\\",
      handler: (e) => {
        e.preventDefault();
        splitActions.splitDown();
      },
    },
    // Ctrl+Shift+W — Close focused pane (ADR-052 §2.8)
    {
      match: (e) => (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "W" && splitActions.paneCount > 1,
      handler: (e) => {
        e.preventDefault();
        splitActions.closePane();
      },
    },
    // Alt+1/2/3/4 — Focus pane by index (ADR-052 §2.8)
    ...[1, 2, 3, 4].map((n) => ({
      match: (e: KeyboardEvent) => e.altKey && e.key === String(n) && !isInputTarget(e),
      handler: (e: KeyboardEvent) => {
        e.preventDefault();
        splitActions.focusPaneByIndex(n - 1);
      },
    })),
    // Alt+[ / Alt+] — Cycle focus (ADR-052 §2.8)
    {
      match: (e) => e.altKey && e.key === "[" && !isInputTarget(e),
      handler: (e) => {
        e.preventDefault();
        splitActions.cycleFocus(-1);
      },
    },
    {
      match: (e) => e.altKey && e.key === "]" && !isInputTarget(e),
      handler: (e) => {
        e.preventDefault();
        splitActions.cycleFocus(1);
      },
    },
  ], [isStreaming, projectId, navigate, copyLastAssistantMessage, reviseLastUserMessage, splitActions]);

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
// Chat page — two-panel layout with split view support
// ---------------------------------------------------------------------------

export default function ChatPage() {
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId?: string }>();
  const navigate = useNavigate();
  const bridgeStatus = useChatStore(selectBridgeStatus);
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

  // Layout store (per-project)
  const layoutStore = useChatLayoutStore(projectId ?? "default");
  const layout = layoutStore((s) => s.layout);
  const panes = layoutStore((s) => s.panes);
  const focusedPaneId = layoutStore((s) => s.focusedPaneId);
  const splitPane = layoutStore((s) => s.splitPane);
  const closePane = layoutStore((s) => s.closePane);
  const setSessionForPane = layoutStore((s) => s.setSessionForPane);
  const setFocusedPane = layoutStore((s) => s.setFocusedPane);
  const setSplitRatio = layoutStore((s) => s.setSplitRatio);
  const resetLayout = layoutStore((s) => s.resetLayout);

  const maxPanes = useMaxPanes();
  const paneCount = countLeaves(layout);
  const paneIds = useMemo(() => collectPaneIds(layout), [layout]);
  const isMultiPane = paneCount > 1;
  const canSplit = paneCount < maxPanes;

  // Fetch bridge status — retry while not ready
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

  // Sync route param to store and load messages for the session (single-pane mode)
  useEffect(() => {
    if (!isMultiPane) {
      setActiveSession(sessionId ?? null);
      if (projectId && sessionId && bridgeStatus === "ready") {
        resumeSession(projectId, sessionId);
      }
    }
  }, [sessionId, projectId, bridgeStatus, setActiveSession, resumeSession, isMultiPane]);

  // When route has sessionId and layout is single-pane, also assign to pane-1
  useEffect(() => {
    if (!isMultiPane && sessionId && panes["pane-1"]?.sessionId !== sessionId) {
      setSessionForPane("pane-1", sessionId);
    }
  }, [isMultiPane, sessionId, panes, setSessionForPane]);

  // Bind socket events for active session (single-pane legacy)
  useChatSocket(isMultiPane ? null : (sessionId ?? null));

  // Split action callbacks
  const splitActions = useMemo(() => ({
    splitRight: () => { if (canSplit) splitPane(focusedPaneId, "vertical"); },
    splitDown: () => { if (canSplit) splitPane(focusedPaneId, "horizontal"); },
    closePane: () => closePane(focusedPaneId),
    focusPaneByIndex: (index: number) => {
      if (index < paneIds.length) setFocusedPane(paneIds[index]!);
    },
    cycleFocus: (delta: number) => {
      const idx = paneIds.indexOf(focusedPaneId);
      const next = (idx + delta + paneIds.length) % paneIds.length;
      setFocusedPane(paneIds[next]!);
    },
    paneCount,
  }), [canSplit, focusedPaneId, paneIds, paneCount, splitPane, closePane, setFocusedPane]);

  // Register keyboard shortcuts
  useChatKeyboardShortcuts(projectId, splitActions);

  const sessionsLoading = bridgeStatus === "ready" && !sessionsFetched;
  const showBridgeNotReady = bridgeStatus !== "ready";

  // Handle session change from a pane
  const handlePaneSessionChange = useCallback((paneId: string, sid: string) => {
    setSessionForPane(paneId, sid);
    // Also update route if single-pane
    if (!isMultiPane && projectId) {
      setActiveSession(sid);
      navigate(`/${projectId}/chat/${sid}`);
    }
  }, [isMultiPane, projectId, setSessionForPane, setActiveSession, navigate]);

  const handleSplitAction = useCallback((direction: SplitDirection) => {
    if (canSplit) splitPane(focusedPaneId, direction);
  }, [canSplit, splitPane, focusedPaneId]);

  return (
    <div className="flex h-full -m-4 md:-m-6">
      {/* Session list panel — hidden on mobile when a session is active */}
      <div className={`${sessionId || isMultiPane ? "hidden md:block" : "w-full md:w-[280px]"} md:w-[280px] flex-shrink-0 border-r border-border bg-background overflow-hidden`}>
        <ChatSessionList loading={sessionsLoading && !showBridgeNotReady} />
      </div>

      {/* Chat area */}
      <div className={`flex-1 flex flex-col min-w-0 ${sessionId || isMultiPane ? "" : "hidden md:flex"}`}>
        {/* Header bar */}
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
          <span className="flex-1" />
          <SplitMenu
            canSplit={canSplit}
            onSplit={handleSplitAction}
            onReset={resetLayout}
            paneCount={paneCount}
          />
        </div>

        {/* Layout area */}
        {bridgeStatus !== "ready" && (
          <ChatEmptyState sessionError={sessionError ?? undefined} />
        )}
        {bridgeStatus === "ready" && isMultiPane && (
          <div className="flex-1 min-h-0">
            <ChatLayoutRenderer
              node={layout}
              panes={panes}
              focusedPaneId={focusedPaneId}
              path={[]}
              onSplitRatio={setSplitRatio}
              onFocusPane={setFocusedPane}
              onClosePane={closePane}
              onSessionChange={handlePaneSessionChange}
              canClose={paneCount > 1}
            />
          </div>
        )}
        {bridgeStatus === "ready" && !isMultiPane && sessionId && (
          <>
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
        )}
        {bridgeStatus === "ready" && !isMultiPane && !sessionId && (
          <ChatEmptyState sessionError={sessionError ?? undefined} />
        )}
      </div>
    </div>
  );
}
