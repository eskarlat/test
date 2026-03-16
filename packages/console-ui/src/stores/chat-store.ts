import { create } from "zustand";
import { apiGet, apiPost, apiDelete } from "../api/client";
import { useSocketStore } from "../api/socket";
import { uuid } from "../lib/utils";
import type {
  Attachment,
  ChatMessage,
  ContentBlock,
  ModelInfo,
  SessionMetadata,
  ToolExecution,
  SubagentExecution,
  PermissionRequest,
  InputRequest,
  ElicitationRequest,
} from "../types/chat";

// ---------------------------------------------------------------------------
// Bridge status type
// ---------------------------------------------------------------------------

type BridgeStatus = "not-initialized" | "starting" | "ready" | "error" | "unavailable";

// ---------------------------------------------------------------------------
// Per-session streaming state (ADR-052 §2.5)
// ---------------------------------------------------------------------------

export interface SessionStreamState {
  streamingContent: string;
  streamingReasoning: string;
  streamingReasoningTokens: number;
  isStreaming: boolean;
  isThinking: boolean;
  ttftMs: number | null;
  activeTools: Map<string, ToolExecution>;
  activeSubagents: Map<string, SubagentExecution>;
  pendingPermission: PermissionRequest | null;
  pendingInput: InputRequest | null;
  pendingElicitation: ElicitationRequest | null;
  contextWindowPct: number;
  isUserScrolledUp: boolean;
  hasNewMessages: boolean;
}

function createDefaultSessionState(): SessionStreamState {
  return {
    streamingContent: "",
    streamingReasoning: "",
    streamingReasoningTokens: 0,
    isStreaming: false,
    isThinking: false,
    ttftMs: null,
    activeTools: new Map(),
    activeSubagents: new Map(),
    pendingPermission: null,
    pendingInput: null,
    pendingElicitation: null,
    contextWindowPct: 0,
    isUserScrolledUp: false,
    hasNewMessages: false,
  };
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface ChatState {
  bridgeStatus: BridgeStatus;
  bridgeError: string | undefined;

  sessions: SessionMetadata[];
  sessionsFetched: boolean;
  activeSessionId: string | null;

  models: ModelInfo[];
  selectedModel: string;
  selectedEffort: "low" | "medium" | "high" | "xhigh";

  messages: Map<string, ChatMessage[]>;

  // Per-session streaming state (ADR-052 §2.5)
  sessionStates: Map<string, SessionStreamState>;

  // Legacy top-level fields — delegates to active session's SessionStreamState
  // for backward compat with components that haven't been refactored yet
  streamingContent: string;
  streamingReasoning: string;
  streamingReasoningTokens: number;
  isStreaming: boolean;
  isThinking: boolean;
  ttftMs: number | null;

  activeTools: Map<string, ToolExecution>;
  activeSubagents: Map<string, SubagentExecution>;

  pendingPermission: PermissionRequest | null;
  pendingInput: InputRequest | null;
  pendingElicitation: ElicitationRequest | null;

  contextWindowPct: number;

  sessionError: string | null;

  isUserScrolledUp: boolean;
  hasNewMessages: boolean;

  revisionDraft: string | null;
  revisionSourceIndex: number | null;

  pendingInitialMessage: string | null;

  autopilot: boolean;

  // Actions
  checkBridgeStatus(): Promise<void>;
  fetchModels(): Promise<void>;
  fetchSessions(projectId: string): Promise<void>;
  createSession(projectId: string): Promise<string | null>;
  resumeSession(projectId: string, sessionId: string): Promise<void>;
  deleteSession(projectId: string, sessionId: string): Promise<void>;
  renameSession(sessionId: string, title: string): void;
  sendMessage(prompt: string, attachments?: Attachment[]): void;
  sendMessageToSession(sessionId: string, prompt: string, attachments?: Attachment[]): void;
  cancelGeneration(): void;
  cancelSessionGeneration(sessionId: string): void;
  setModel(modelId: string): void;
  setEffort(effort: "low" | "medium" | "high" | "xhigh"): void;
  setActiveSession(sessionId: string | null): void;
  scrollToBottom(): void;
  setUserScrolledUp(value: boolean): void;
  clearStreamingState(): void;
  clearSessionStreamingState(sessionId: string): void;
  appendMessage(sessionId: string, message: ChatMessage): void;
  updateLastAssistantBlock(sessionId: string, block: ContentBlock): void;
  finalizeAssistantMessage(sessionId: string, fallbackContent?: string): void;
  reviseTo(messageIndex: number): void;
  setAutopilot(enabled: boolean): void;
  respondToPermission(requestId: string, approved: boolean): void;
  respondToInput(requestId: string, answer: string): void;
  respondToElicitation(requestId: string, data: Record<string, unknown>): void;
  getSessionState(sessionId: string): SessionStreamState;
  updateSessionState(sessionId: string, updates: Partial<SessionStreamState>): void;
  reset(): void;
}

// ---------------------------------------------------------------------------
// RAF-based streaming buffer — per-session (ADR-052 §2.5)
// ---------------------------------------------------------------------------

interface StreamBuffer {
  deltaBuffer: string;
  reasoningBuffer: string;
  rafId: number | null;
  turnStartTime: number | null;
}

const sessionBuffers = new Map<string, StreamBuffer>();

function getBuffer(sessionId: string): StreamBuffer {
  let buf = sessionBuffers.get(sessionId);
  if (!buf) {
    buf = { deltaBuffer: "", reasoningBuffer: "", rafId: null, turnStartTime: null };
    sessionBuffers.set(sessionId, buf);
  }
  return buf;
}

function flushSessionBuffers(
  sessionId: string,
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
): void {
  const buf = getBuffer(sessionId);
  const pendingDelta = buf.deltaBuffer;
  const pendingReasoning = buf.reasoningBuffer;
  buf.deltaBuffer = "";
  buf.reasoningBuffer = "";
  buf.rafId = null;

  set((s) => {
    const ss = s.sessionStates.get(sessionId) ?? createDefaultSessionState();
    const updates: Partial<SessionStreamState> = {};
    if (pendingDelta) {
      updates.streamingContent = ss.streamingContent + pendingDelta;
      if (ss.ttftMs === null && buf.turnStartTime !== null) {
        updates.ttftMs = performance.now() - buf.turnStartTime;
      }
    }
    if (pendingReasoning) {
      updates.streamingReasoning = ss.streamingReasoning + pendingReasoning;
    }

    const newStates = new Map(s.sessionStates);
    newStates.set(sessionId, { ...ss, ...updates });

    // Sync top-level fields if this is the active session
    const topLevel: Partial<ChatState> = { sessionStates: newStates };
    if (s.activeSessionId === sessionId) {
      if (updates.streamingContent !== undefined) topLevel.streamingContent = updates.streamingContent;
      if (updates.streamingReasoning !== undefined) topLevel.streamingReasoning = updates.streamingReasoning;
      if (updates.ttftMs !== undefined) topLevel.ttftMs = updates.ttftMs;
    }
    return topLevel;
  });
}

function scheduleSessionFlush(
  sessionId: string,
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
): void {
  const buf = getBuffer(sessionId);
  if (!buf.rafId && !document.hidden) {
    buf.rafId = requestAnimationFrame(() => flushSessionBuffers(sessionId, set));
  }
}

// Legacy module-level buffers for backward compatibility
let deltaBuffer = "";
let reasoningBuffer = "";
let rafId: number | null = null;
let turnStartTime: number | null = null;

function flushBuffers(set: (fn: (s: ChatState) => Partial<ChatState>) => void): void {
  const pendingDelta = deltaBuffer;
  const pendingReasoning = reasoningBuffer;
  deltaBuffer = "";
  reasoningBuffer = "";
  rafId = null;

  set((s) => {
    const updates: Partial<ChatState> = {};
    if (pendingDelta) {
      updates.streamingContent = s.streamingContent + pendingDelta;
      if (s.ttftMs === null && turnStartTime !== null) {
        updates.ttftMs = performance.now() - turnStartTime;
      }
    }
    if (pendingReasoning) {
      updates.streamingReasoning = s.streamingReasoning + pendingReasoning;
    }
    return updates;
  });
}

function scheduleFlush(set: (fn: (s: ChatState) => Partial<ChatState>) => void): void {
  if (!rafId && !document.hidden) {
    rafId = requestAnimationFrame(() => flushBuffers(set));
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useChatStore = create<ChatState>()((set, get) => ({
  bridgeStatus: "not-initialized",
  bridgeError: undefined,

  sessions: [],
  sessionsFetched: false,
  activeSessionId: null,

  models: [],
  selectedModel: "",
  selectedEffort: "medium",

  messages: new Map(),

  sessionStates: new Map(),

  streamingContent: "",
  streamingReasoning: "",
  streamingReasoningTokens: 0,
  isStreaming: false,
  isThinking: false,
  ttftMs: null,

  activeTools: new Map(),
  activeSubagents: new Map(),

  pendingPermission: null,
  pendingInput: null,
  pendingElicitation: null,

  contextWindowPct: 0,

  sessionError: null,

  isUserScrolledUp: false,
  hasNewMessages: false,

  revisionDraft: null,
  revisionSourceIndex: null,

  pendingInitialMessage: null,

  autopilot: false,

  // -------------------------------------------------------------------
  // REST actions
  // -------------------------------------------------------------------

  checkBridgeStatus: async () => {
    const res = await apiGet<{ status: BridgeStatus; error: string | undefined }>("/api/chat/status");
    if (res.data) {
      set({ bridgeStatus: res.data.status, bridgeError: res.data.error ?? undefined });
    } else {
      set({ bridgeStatus: "unavailable", bridgeError: res.error ?? "Connection failed" });
    }
  },

  fetchModels: async () => {
    const res = await apiGet<ModelInfo[]>("/api/chat/models");
    if (res.data) {
      set({ models: res.data });
      if (!get().selectedModel && res.data.length > 0) {
        set({ selectedModel: res.data[0]!.id });
      }
    }
  },

  fetchSessions: async (projectId) => {
    const res = await apiGet<SessionMetadata[]>(`/api/${projectId}/chat/sessions`);
    if (res.data) {
      set({ sessions: res.data, sessionsFetched: true });
    }
  },

  createSession: async (projectId) => {
    const { selectedModel, selectedEffort } = get();
    const res = await apiPost<{ sessionId: string }>(`/api/${projectId}/chat/sessions`, {
      model: selectedModel,
      reasoningEffort: selectedEffort,
    });
    if (res.data) {
      const newSession: SessionMetadata = {
        id: res.data.sessionId,
        projectId,
        model: selectedModel,
        reasoningEffort: selectedEffort,
        createdAt: new Date().toISOString(),
        messageCount: 0,
      };
      set((s) => ({
        sessions: [newSession, ...s.sessions],
        activeSessionId: res.data!.sessionId,
      }));
      return res.data.sessionId;
    }
    return null;
  },

  resumeSession: async (projectId, sessionId) => {
    const res = await apiPost<{ messages: ChatMessage[] }>(
      `/api/${projectId}/chat/sessions/${sessionId}/resume`,
      {},
    );
    if (res.data?.messages) {
      set((s) => {
        if (s.isStreaming) {
          return { activeSessionId: sessionId };
        }
        const next = new Map(s.messages);
        const existing = next.get(sessionId);
        const serverMsgs = res.data!.messages;
        if (serverMsgs.length > 0 || !existing || existing.length === 0) {
          next.set(sessionId, serverMsgs);
        }
        return { messages: next, activeSessionId: sessionId };
      });
    }
  },

  deleteSession: async (projectId, sessionId) => {
    const res = await apiDelete(`/api/${projectId}/chat/sessions/${sessionId}`);
    if (res.data) {
      set((s) => {
        const messages = new Map(s.messages);
        messages.delete(sessionId);
        const sessionStates = new Map(s.sessionStates);
        sessionStates.delete(sessionId);
        return {
          sessions: s.sessions.filter((sess) => sess.id !== sessionId),
          activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
          messages,
          sessionStates,
        };
      });
    }
  },

  renameSession: (sessionId, title) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, title } : sess,
      ),
    }));
  },

  // -------------------------------------------------------------------
  // Socket actions
  // -------------------------------------------------------------------

  sendMessage: (prompt, attachments) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    get().sendMessageToSession(sessionId, prompt, attachments);
  },

  sendMessageToSession: (sessionId, prompt, attachments) => {
    const socket = useSocketStore.getState().socket;
    if (!socket) return;

    const userMessage: ChatMessage = {
      id: uuid(),
      role: "user",
      blocks: [{ type: "text", content: prompt }],
      timestamp: new Date().toISOString(),
      ...(attachments ? { attachments } : {}),
      isStreaming: false,
    };

    set((s) => {
      const next = new Map(s.messages);
      const msgs = [...(next.get(sessionId) ?? []), userMessage];
      next.set(sessionId, msgs);
      return { messages: next };
    });

    socket.emit("chat:send", { prompt, sessionId, attachments });
  },

  cancelGeneration: () => {
    const sessionId = get().activeSessionId;
    if (sessionId) get().cancelSessionGeneration(sessionId);
  },

  cancelSessionGeneration: (sessionId) => {
    const socket = useSocketStore.getState().socket;
    if (!socket) return;
    socket.emit("chat:cancel", { sessionId });
  },

  // -------------------------------------------------------------------
  // Setters
  // -------------------------------------------------------------------

  setModel: (modelId) => set({ selectedModel: modelId }),
  setEffort: (effort) => set({ selectedEffort: effort }),
  setActiveSession: (sessionId) => {
    // When switching active session, sync top-level fields from the new session's state
    const ss = sessionId ? get().sessionStates.get(sessionId) ?? createDefaultSessionState() : createDefaultSessionState();
    set({
      activeSessionId: sessionId,
      streamingContent: ss.streamingContent,
      streamingReasoning: ss.streamingReasoning,
      streamingReasoningTokens: ss.streamingReasoningTokens,
      isStreaming: ss.isStreaming,
      isThinking: ss.isThinking,
      ttftMs: ss.ttftMs,
      activeTools: ss.activeTools,
      activeSubagents: ss.activeSubagents,
      pendingPermission: ss.pendingPermission,
      pendingInput: ss.pendingInput,
      pendingElicitation: ss.pendingElicitation,
      contextWindowPct: ss.contextWindowPct,
      isUserScrolledUp: ss.isUserScrolledUp,
      hasNewMessages: ss.hasNewMessages,
    });
  },

  scrollToBottom: () => set({ isUserScrolledUp: false, hasNewMessages: false }),
  setUserScrolledUp: (value) => set({ isUserScrolledUp: value }),

  clearStreamingState: () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    deltaBuffer = "";
    reasoningBuffer = "";
    turnStartTime = null;
    set({
      streamingContent: "",
      streamingReasoning: "",
      streamingReasoningTokens: 0,
      isStreaming: false,
      isThinking: false,
      ttftMs: null,
    });
  },

  clearSessionStreamingState: (sessionId) => {
    const buf = sessionBuffers.get(sessionId);
    if (buf) {
      if (buf.rafId) cancelAnimationFrame(buf.rafId);
      sessionBuffers.delete(sessionId);
    }
    set((s) => {
      const newStates = new Map(s.sessionStates);
      const ss = newStates.get(sessionId);
      if (ss) {
        newStates.set(sessionId, {
          ...ss,
          streamingContent: "",
          streamingReasoning: "",
          streamingReasoningTokens: 0,
          isStreaming: false,
          isThinking: false,
          ttftMs: null,
        });
      }
      const topLevel: Partial<ChatState> = { sessionStates: newStates };
      if (s.activeSessionId === sessionId) {
        topLevel.streamingContent = "";
        topLevel.streamingReasoning = "";
        topLevel.streamingReasoningTokens = 0;
        topLevel.isStreaming = false;
        topLevel.isThinking = false;
        topLevel.ttftMs = null;
      }
      return topLevel;
    });
  },

  appendMessage: (sessionId, message) => {
    set((s) => {
      const next = new Map(s.messages);
      const msgs = [...(next.get(sessionId) ?? []), message];
      next.set(sessionId, msgs);
      const ss = s.sessionStates.get(sessionId) ?? createDefaultSessionState();
      const hasNew = ss.isUserScrolledUp;
      const newStates = new Map(s.sessionStates);
      newStates.set(sessionId, { ...ss, hasNewMessages: hasNew });
      return {
        messages: next,
        sessionStates: newStates,
        hasNewMessages: s.activeSessionId === sessionId ? hasNew : s.hasNewMessages,
      };
    });
  },

  updateLastAssistantBlock: (sessionId, block) => {
    set((s) => {
      const next = new Map(s.messages);
      const msgs = next.get(sessionId);
      if (!msgs || msgs.length === 0) return {};
      const last = msgs[msgs.length - 1]!;
      if (last.role !== "assistant") return {};
      const updatedMsg = { ...last, blocks: [...last.blocks.slice(0, -1), block] };
      next.set(sessionId, [...msgs.slice(0, -1), updatedMsg]);
      return { messages: next };
    });
  },

  finalizeAssistantMessage: (sessionId, fallbackContent?) => {
    const ss = get().sessionStates.get(sessionId);
    if (!ss?.isStreaming && !get().isStreaming) return;

    // Flush per-session buffers
    const buf = getBuffer(sessionId);
    if (buf.rafId) {
      cancelAnimationFrame(buf.rafId);
      buf.rafId = null;
    }
    const pendingDelta = buf.deltaBuffer + (ss?.streamingContent ?? "");
    const pendingReasoning = buf.reasoningBuffer + (ss?.streamingReasoning ?? "");
    buf.deltaBuffer = "";
    buf.reasoningBuffer = "";
    buf.turnStartTime = null;

    // Also flush legacy buffers if active session
    if (get().activeSessionId === sessionId) {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      const legacyDelta = deltaBuffer + get().streamingContent;
      const legacyReasoning = reasoningBuffer + get().streamingReasoning;
      deltaBuffer = "";
      reasoningBuffer = "";
      turnStartTime = null;

      // Use whichever has content
      const finalContent = pendingDelta || legacyDelta || fallbackContent || "";
      const finalReasoning = pendingReasoning || legacyReasoning;

      set((s) => {
        const next = new Map(s.messages);
        const msgs = next.get(sessionId);
        if (!msgs || msgs.length === 0) {
          return syncSessionStreamClear(s, sessionId);
        }
        const last = msgs[msgs.length - 1]!;
        if (last.role !== "assistant") {
          return syncSessionStreamClear(s, sessionId);
        }

        const blocks = [...last.blocks];
        finalizeBlocks(blocks, finalReasoning, finalContent);

        const updated = { ...last, blocks, isStreaming: false };
        next.set(sessionId, [...msgs.slice(0, -1), updated]);
        return {
          messages: next,
          ...syncSessionStreamClear(s, sessionId),
        };
      });
    } else {
      const finalContent = pendingDelta || fallbackContent || "";
      set((s) => {
        const next = new Map(s.messages);
        const msgs = next.get(sessionId);
        if (!msgs || msgs.length === 0) {
          return syncSessionStreamClear(s, sessionId);
        }
        const last = msgs[msgs.length - 1]!;
        if (last.role !== "assistant") {
          return syncSessionStreamClear(s, sessionId);
        }

        const blocks = [...last.blocks];
        finalizeBlocks(blocks, pendingReasoning, finalContent);

        const updated = { ...last, blocks, isStreaming: false };
        next.set(sessionId, [...msgs.slice(0, -1), updated]);
        return {
          messages: next,
          ...syncSessionStreamClear(s, sessionId),
        };
      });
    }
  },

  reviseTo: (messageIndex) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    const msgs = get().messages.get(sessionId);
    if (!msgs || messageIndex < 0 || messageIndex >= msgs.length) return;
    const msg = msgs[messageIndex];
    if (!msg || msg.role !== "user") return;

    const textBlock = msg.blocks.find((b) => b.type === "text");
    if (textBlock && textBlock.type === "text") {
      set({ revisionDraft: textBlock.content, revisionSourceIndex: messageIndex });
    }
  },

  setAutopilot: (enabled) => set({ autopilot: enabled }),

  respondToPermission: (requestId, approved) => {
    const socket = useSocketStore.getState().socket;
    if (!socket) return;
    socket.emit("chat:permission", {
      requestId,
      decision: { kind: approved ? "approved" : "denied-interactively-by-user" },
    });
    set({ pendingPermission: null });
    // Also clear from session states
    set((s) => {
      const newStates = new Map(s.sessionStates);
      for (const [sid, ss] of newStates) {
        if (ss.pendingPermission?.requestId === requestId) {
          newStates.set(sid, { ...ss, pendingPermission: null });
        }
      }
      return { sessionStates: newStates };
    });
  },

  respondToInput: (requestId, answer) => {
    const socket = useSocketStore.getState().socket;
    if (!socket) return;
    socket.emit("chat:input", { requestId, answer });
    set({ pendingInput: null });
    set((s) => {
      const newStates = new Map(s.sessionStates);
      for (const [sid, ss] of newStates) {
        if (ss.pendingInput?.requestId === requestId) {
          newStates.set(sid, { ...ss, pendingInput: null });
        }
      }
      return { sessionStates: newStates };
    });
  },

  respondToElicitation: (requestId, data) => {
    const socket = useSocketStore.getState().socket;
    if (!socket) return;
    socket.emit("chat:elicitation", { requestId, data });
    set({ pendingElicitation: null });
    set((s) => {
      const newStates = new Map(s.sessionStates);
      for (const [sid, ss] of newStates) {
        if (ss.pendingElicitation?.requestId === requestId) {
          newStates.set(sid, { ...ss, pendingElicitation: null });
        }
      }
      return { sessionStates: newStates };
    });
  },

  getSessionState: (sessionId) => {
    return get().sessionStates.get(sessionId) ?? createDefaultSessionState();
  },

  updateSessionState: (sessionId, updates) => {
    set((s) => {
      const newStates = new Map(s.sessionStates);
      const ss = newStates.get(sessionId) ?? createDefaultSessionState();
      newStates.set(sessionId, { ...ss, ...updates });
      const topLevel: Partial<ChatState> = { sessionStates: newStates };
      // Sync to top-level if active session
      if (s.activeSessionId === sessionId) {
        if (updates.isStreaming !== undefined) topLevel.isStreaming = updates.isStreaming;
        if (updates.streamingContent !== undefined) topLevel.streamingContent = updates.streamingContent;
        if (updates.streamingReasoning !== undefined) topLevel.streamingReasoning = updates.streamingReasoning;
        if (updates.streamingReasoningTokens !== undefined) topLevel.streamingReasoningTokens = updates.streamingReasoningTokens;
        if (updates.isThinking !== undefined) topLevel.isThinking = updates.isThinking;
        if (updates.ttftMs !== undefined) topLevel.ttftMs = updates.ttftMs;
        if (updates.activeTools !== undefined) topLevel.activeTools = updates.activeTools;
        if (updates.activeSubagents !== undefined) topLevel.activeSubagents = updates.activeSubagents;
        if (updates.pendingPermission !== undefined) topLevel.pendingPermission = updates.pendingPermission;
        if (updates.pendingInput !== undefined) topLevel.pendingInput = updates.pendingInput;
        if (updates.pendingElicitation !== undefined) topLevel.pendingElicitation = updates.pendingElicitation;
        if (updates.contextWindowPct !== undefined) topLevel.contextWindowPct = updates.contextWindowPct;
        if (updates.isUserScrolledUp !== undefined) topLevel.isUserScrolledUp = updates.isUserScrolledUp;
        if (updates.hasNewMessages !== undefined) topLevel.hasNewMessages = updates.hasNewMessages;
      }
      return topLevel;
    });
  },

  reset: () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    deltaBuffer = "";
    reasoningBuffer = "";
    turnStartTime = null;
    // Clean up per-session buffers
    for (const buf of sessionBuffers.values()) {
      if (buf.rafId) cancelAnimationFrame(buf.rafId);
    }
    sessionBuffers.clear();
    set({
      sessions: [],
      sessionsFetched: false,
      activeSessionId: null,
      messages: new Map(),
      sessionStates: new Map(),
      streamingContent: "",
      streamingReasoning: "",
      streamingReasoningTokens: 0,
      isStreaming: false,
      isThinking: false,
      ttftMs: null,
      activeTools: new Map(),
      activeSubagents: new Map(),
      pendingPermission: null,
      pendingInput: null,
      pendingElicitation: null,
      contextWindowPct: 0,
      sessionError: null,
      isUserScrolledUp: false,
      hasNewMessages: false,
      revisionDraft: null,
      revisionSourceIndex: null,
      pendingInitialMessage: null,
    });
  },
}));

// ---------------------------------------------------------------------------
// Helper: finalize blocks with accumulated content
// ---------------------------------------------------------------------------

function finalizeBlocks(blocks: ContentBlock[], reasoning: string, content: string): void {
  if (reasoning) {
    const reasoningIdx = blocks.findIndex((b) => b.type === "reasoning");
    if (reasoningIdx >= 0) {
      const rb = blocks[reasoningIdx]!;
      if (rb.type === "reasoning") {
        blocks[reasoningIdx] = { ...rb, content: rb.content + reasoning };
      }
    } else {
      const insertIdx = blocks.findIndex((b) => b.type === "text");
      const reasoningBlock = { type: "reasoning" as const, content: reasoning, collapsed: false };
      if (insertIdx >= 0) {
        blocks.splice(insertIdx, 0, reasoningBlock);
      } else {
        blocks.push(reasoningBlock);
      }
    }
  }

  if (content) {
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock?.type === "text") {
      blocks[blocks.length - 1] = { ...lastBlock, content: lastBlock.content + content };
    } else {
      blocks.push({ type: "text", content });
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: clear streaming state for a session + sync top-level
// ---------------------------------------------------------------------------

function syncSessionStreamClear(s: ChatState, sessionId: string): Partial<ChatState> {
  const newStates = new Map(s.sessionStates);
  const ss = newStates.get(sessionId);
  if (ss) {
    newStates.set(sessionId, {
      ...ss,
      streamingContent: "",
      streamingReasoning: "",
      streamingReasoningTokens: 0,
      isStreaming: false,
      isThinking: false,
    });
  }
  const result: Partial<ChatState> = { sessionStates: newStates };
  if (s.activeSessionId === sessionId) {
    result.isStreaming = false;
    result.streamingContent = "";
    result.streamingReasoning = "";
    result.streamingReasoningTokens = 0;
    result.isThinking = false;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Session-scoped event handlers (ADR-052 §2.5)
// ---------------------------------------------------------------------------

export function onSessionMessageDelta(sessionId: string, delta: string): void {
  const buf = getBuffer(sessionId);
  buf.deltaBuffer += delta;
  scheduleSessionFlush(sessionId, useChatStore.setState.bind(useChatStore));
}

export function onSessionReasoningDelta(sessionId: string, delta: string): void {
  const buf = getBuffer(sessionId);
  buf.reasoningBuffer += delta;
  scheduleSessionFlush(sessionId, useChatStore.setState.bind(useChatStore));
}

export function onSessionTurnStart(sessionId: string): void {
  const buf = getBuffer(sessionId);
  buf.turnStartTime = performance.now();
  useChatStore.getState().updateSessionState(sessionId, {
    isStreaming: true,
    ttftMs: null,
    streamingContent: "",
    streamingReasoning: "",
  });
}

// ---------------------------------------------------------------------------
// Legacy event handlers (backward compat with existing socket binding)
// ---------------------------------------------------------------------------

export function onMessageDelta(delta: string): void {
  deltaBuffer += delta;
  scheduleFlush(useChatStore.setState.bind(useChatStore));
}

export function onReasoningDelta(delta: string): void {
  reasoningBuffer += delta;
  scheduleFlush(useChatStore.setState.bind(useChatStore));
}

export function onTurnStart(): void {
  turnStartTime = performance.now();
  useChatStore.setState({ isStreaming: true, ttftMs: null, streamingContent: "", streamingReasoning: "" });
}

export function onVisibilityChange(): void {
  if (!document.hidden && (deltaBuffer || reasoningBuffer)) {
    flushBuffers(useChatStore.setState.bind(useChatStore));
  }
  // Also flush per-session buffers
  if (!document.hidden) {
    for (const [sid, buf] of sessionBuffers) {
      if (buf.deltaBuffer || buf.reasoningBuffer) {
        flushSessionBuffers(sid, useChatStore.setState.bind(useChatStore));
      }
    }
  }
}

export { createDefaultSessionState };
