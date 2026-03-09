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
  cancelGeneration(): void;
  setModel(modelId: string): void;
  setEffort(effort: "low" | "medium" | "high" | "xhigh"): void;
  setActiveSession(sessionId: string | null): void;
  scrollToBottom(): void;
  setUserScrolledUp(value: boolean): void;
  clearStreamingState(): void;
  appendMessage(sessionId: string, message: ChatMessage): void;
  updateLastAssistantBlock(sessionId: string, block: ContentBlock): void;
  finalizeAssistantMessage(sessionId: string, fallbackContent?: string): void;
  reviseTo(messageIndex: number): void;
  setAutopilot(enabled: boolean): void;
  respondToPermission(requestId: string, approved: boolean): void;
  respondToInput(requestId: string, answer: string): void;
  respondToElicitation(requestId: string, data: Record<string, unknown>): void;
  reset(): void;
}

// ---------------------------------------------------------------------------
// RAF-based streaming buffer
// ---------------------------------------------------------------------------

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
        // Don't overwrite messages during active streaming — the local state
        // has the streaming assistant message that would be lost.
        if (s.isStreaming) {
          return { activeSessionId: sessionId };
        }
        const next = new Map(s.messages);
        const existing = next.get(sessionId);
        const serverMsgs = res.data!.messages;
        // Don't overwrite local messages with empty server response.
        // This prevents a race condition where sendMessage adds a local
        // message before the resume response arrives with an empty array.
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
        return {
          sessions: s.sessions.filter((sess) => sess.id !== sessionId),
          activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
          messages,
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
    const socket = useSocketStore.getState().socket;
    if (!socket) return;

    const sessionId = get().activeSessionId;
    if (!sessionId) return;

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

    socket.emit("chat:send", { prompt, attachments });
  },

  cancelGeneration: () => {
    const socket = useSocketStore.getState().socket;
    if (!socket) return;
    socket.emit("chat:cancel", {});
  },

  // -------------------------------------------------------------------
  // Setters
  // -------------------------------------------------------------------

  setModel: (modelId) => set({ selectedModel: modelId }),
  setEffort: (effort) => set({ selectedEffort: effort }),
  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

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

  appendMessage: (sessionId, message) => {
    set((s) => {
      const next = new Map(s.messages);
      const msgs = [...(next.get(sessionId) ?? []), message];
      next.set(sessionId, msgs);
      return { messages: next, hasNewMessages: s.isUserScrolledUp };
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
    // Guard: if not streaming, finalization already happened (prevents content doubling
    // when both handleMessage and handleTurnEnd fire)
    if (!get().isStreaming) return;

    // Flush any remaining buffers
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    const pendingDelta = deltaBuffer + get().streamingContent;
    const pendingReasoning = reasoningBuffer + get().streamingReasoning;
    deltaBuffer = "";
    reasoningBuffer = "";
    turnStartTime = null;

    // Use fallback content if no streaming deltas were received
    const finalContent = pendingDelta || fallbackContent || "";

    set((s) => {
      const next = new Map(s.messages);
      const msgs = next.get(sessionId);
      if (!msgs || msgs.length === 0) return { isStreaming: false };
      const last = msgs[msgs.length - 1]!;
      if (last.role !== "assistant") return { isStreaming: false };

      const blocks = [...last.blocks];

      // Finalize streaming reasoning — insert before text content
      if (pendingReasoning) {
        const reasoningIdx = blocks.findIndex((b) => b.type === "reasoning");
        if (reasoningIdx >= 0) {
          const rb = blocks[reasoningIdx]!;
          if (rb.type === "reasoning") {
            blocks[reasoningIdx] = { ...rb, content: rb.content + pendingReasoning };
          }
        } else {
          // No existing reasoning block — create one at the start (before text)
          const insertIdx = blocks.findIndex((b) => b.type === "text");
          const reasoningBlock = { type: "reasoning" as const, content: pendingReasoning, collapsed: false };
          if (insertIdx >= 0) {
            blocks.splice(insertIdx, 0, reasoningBlock);
          } else {
            blocks.push(reasoningBlock);
          }
        }
      }

      // Finalize streaming text (or use fallback content from assistant.message)
      if (finalContent) {
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock?.type === "text") {
          blocks[blocks.length - 1] = { ...lastBlock, content: lastBlock.content + finalContent };
        } else {
          blocks.push({ type: "text", content: finalContent });
        }
      }

      const updated = { ...last, blocks, isStreaming: false };
      next.set(sessionId, [...msgs.slice(0, -1), updated]);
      return {
        messages: next,
        isStreaming: false,
        streamingContent: "",
        streamingReasoning: "",
        streamingReasoningTokens: 0,
        isThinking: false,
      };
    });
  },

  reviseTo: (messageIndex) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    const msgs = get().messages.get(sessionId);
    if (!msgs || messageIndex < 0 || messageIndex >= msgs.length) return;
    const msg = msgs[messageIndex];
    if (!msg || msg.role !== "user") return;

    // Extract the text from the user message so the input can be pre-populated
    const textBlock = msg.blocks.find((b) => b.type === "text");
    if (textBlock && textBlock.type === "text") {
      // Store the revision target — the chat page keyboard handler reads this
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
  },

  respondToInput: (requestId, answer) => {
    const socket = useSocketStore.getState().socket;
    if (!socket) return;
    socket.emit("chat:input", { requestId, answer });
    set({ pendingInput: null });
  },

  respondToElicitation: (requestId, data) => {
    const socket = useSocketStore.getState().socket;
    if (!socket) return;
    socket.emit("chat:elicitation", { requestId, data });
    set({ pendingElicitation: null });
  },

  reset: () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    deltaBuffer = "";
    reasoningBuffer = "";
    turnStartTime = null;
    set({
      sessions: [],
      sessionsFetched: false,
      activeSessionId: null,
      messages: new Map(),
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
// Socket.IO chat event binding hook
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
}
