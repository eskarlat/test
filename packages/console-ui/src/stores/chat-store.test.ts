import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  apiPut: vi.fn(),
  BASE_URL: "http://localhost:42888",
}));

// Mock the socket store
const mockEmit = vi.fn();
vi.mock("../api/socket", () => ({
  useSocketStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ socket: { emit: mockEmit } }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

// Mock uuid
vi.mock("../lib/utils", () => ({
  uuid: vi.fn(() => "test-uuid-1234"),
  cn: vi.fn(),
}));

import { useChatStore } from "./chat-store";
import { apiGet, apiPost, apiDelete } from "../api/client";

const mockApiGet = vi.mocked(apiGet);
const mockApiPost = vi.mocked(apiPost);
const mockApiDelete = vi.mocked(apiDelete);

// Stub requestAnimationFrame / cancelAnimationFrame for Node environment
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(Date.now()), 0) as unknown as number;
  };
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

// Stub document.hidden
if (typeof globalThis.document === "undefined") {
  (globalThis as Record<string, unknown>).document = { hidden: false };
}

// Stub performance.now
if (typeof globalThis.performance === "undefined") {
  (globalThis as Record<string, unknown>).performance = { now: () => Date.now() };
}

function resetStore(): void {
  useChatStore.setState({
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
  });
}

describe("chat-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmit.mockClear();
    resetStore();
  });

  describe("checkBridgeStatus", () => {
    it("sets bridge status on success", async () => {
      mockApiGet.mockResolvedValueOnce({
        data: { status: "ready", error: undefined },
        error: null,
        status: 200,
      });

      await useChatStore.getState().checkBridgeStatus();

      expect(mockApiGet).toHaveBeenCalledWith("/api/chat/status");
      expect(useChatStore.getState().bridgeStatus).toBe("ready");
      expect(useChatStore.getState().bridgeError).toBeUndefined();
    });

    it("sets unavailable when API fails", async () => {
      mockApiGet.mockResolvedValueOnce({
        data: null,
        error: "Connection failed",
        status: 500,
      });

      await useChatStore.getState().checkBridgeStatus();

      expect(useChatStore.getState().bridgeStatus).toBe("unavailable");
      expect(useChatStore.getState().bridgeError).toBe("Connection failed");
    });
  });

  describe("fetchModels", () => {
    it("sets models and auto-selects first model", async () => {
      const models = [
        { id: "claude-3-opus", name: "Claude 3 Opus" },
        { id: "claude-3-sonnet", name: "Claude 3 Sonnet" },
      ];
      mockApiGet.mockResolvedValueOnce({ data: models, error: null, status: 200 });

      await useChatStore.getState().fetchModels();

      expect(mockApiGet).toHaveBeenCalledWith("/api/chat/models");
      expect(useChatStore.getState().models).toEqual(models);
      expect(useChatStore.getState().selectedModel).toBe("claude-3-opus");
    });

    it("does not overwrite already selected model", async () => {
      useChatStore.setState({ selectedModel: "claude-3-sonnet" });
      const models = [
        { id: "claude-3-opus", name: "Claude 3 Opus" },
        { id: "claude-3-sonnet", name: "Claude 3 Sonnet" },
      ];
      mockApiGet.mockResolvedValueOnce({ data: models, error: null, status: 200 });

      await useChatStore.getState().fetchModels();

      expect(useChatStore.getState().selectedModel).toBe("claude-3-sonnet");
    });

    it("does not update on API failure", async () => {
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Error", status: 500 });

      await useChatStore.getState().fetchModels();

      expect(useChatStore.getState().models).toEqual([]);
    });
  });

  describe("fetchSessions", () => {
    it("populates sessions", async () => {
      const sessions = [
        {
          id: "sess-1",
          projectId: "proj-1",
          model: "claude-3",
          reasoningEffort: "medium" as const,
          createdAt: "2026-01-01T00:00:00Z",
          messageCount: 5,
        },
      ];
      mockApiGet.mockResolvedValueOnce({ data: sessions, error: null, status: 200 });

      await useChatStore.getState().fetchSessions("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/chat/sessions");
      expect(useChatStore.getState().sessions).toEqual(sessions);
      expect(useChatStore.getState().sessionsFetched).toBe(true);
    });
  });

  describe("createSession", () => {
    it("creates session and adds to store", async () => {
      useChatStore.setState({ selectedModel: "claude-3", selectedEffort: "high" });
      mockApiPost.mockResolvedValueOnce({
        data: { sessionId: "new-sess" },
        error: null,
        status: 201,
      });

      const sessionId = await useChatStore.getState().createSession("proj-1");

      expect(sessionId).toBe("new-sess");
      expect(mockApiPost).toHaveBeenCalledWith("/api/proj-1/chat/sessions", {
        model: "claude-3",
        reasoningEffort: "high",
      });
      expect(useChatStore.getState().sessions).toHaveLength(1);
      expect(useChatStore.getState().sessions[0]!.id).toBe("new-sess");
      expect(useChatStore.getState().activeSessionId).toBe("new-sess");
    });

    it("returns null on API failure", async () => {
      mockApiPost.mockResolvedValueOnce({ data: null, error: "Error", status: 500 });

      const sessionId = await useChatStore.getState().createSession("proj-1");

      expect(sessionId).toBeNull();
      expect(useChatStore.getState().sessions).toEqual([]);
    });
  });

  describe("deleteSession", () => {
    it("removes session and its messages", async () => {
      const messages = new Map<string, Array<{ id: string; role: string; blocks: Array<{ type: string; content: string }>; timestamp: string; isStreaming: boolean }>>();
      messages.set("sess-1", [
        { id: "msg-1", role: "user", blocks: [{ type: "text", content: "hello" }], timestamp: "2026-01-01T00:00:00Z", isStreaming: false },
      ]);
      messages.set("sess-2", [
        { id: "msg-2", role: "user", blocks: [{ type: "text", content: "world" }], timestamp: "2026-01-01T00:00:00Z", isStreaming: false },
      ]);
      useChatStore.setState({
        sessions: [
          { id: "sess-1", projectId: "proj-1", model: "claude-3", reasoningEffort: "medium" as const, createdAt: "2026-01-01T00:00:00Z", messageCount: 1 },
          { id: "sess-2", projectId: "proj-1", model: "claude-3", reasoningEffort: "medium" as const, createdAt: "2026-01-01T00:00:00Z", messageCount: 1 },
        ],
        activeSessionId: "sess-1",
        messages,
      });
      mockApiDelete.mockResolvedValueOnce({ data: { ok: true }, error: null, status: 200 });

      await useChatStore.getState().deleteSession("proj-1", "sess-1");

      expect(useChatStore.getState().sessions).toHaveLength(1);
      expect(useChatStore.getState().sessions[0]!.id).toBe("sess-2");
      expect(useChatStore.getState().messages.has("sess-1")).toBe(false);
      expect(useChatStore.getState().messages.has("sess-2")).toBe(true);
      expect(useChatStore.getState().activeSessionId).toBeNull();
    });

    it("does not clear activeSessionId when deleting a different session", async () => {
      useChatStore.setState({
        sessions: [
          { id: "sess-1", projectId: "proj-1", model: "claude-3", reasoningEffort: "medium" as const, createdAt: "2026-01-01T00:00:00Z", messageCount: 1 },
          { id: "sess-2", projectId: "proj-1", model: "claude-3", reasoningEffort: "medium" as const, createdAt: "2026-01-01T00:00:00Z", messageCount: 1 },
        ],
        activeSessionId: "sess-1",
      });
      mockApiDelete.mockResolvedValueOnce({ data: { ok: true }, error: null, status: 200 });

      await useChatStore.getState().deleteSession("proj-1", "sess-2");

      expect(useChatStore.getState().activeSessionId).toBe("sess-1");
    });
  });

  describe("sendMessage", () => {
    it("adds user message to messages Map and emits socket event", () => {
      useChatStore.setState({ activeSessionId: "sess-1" });

      useChatStore.getState().sendMessage("Hello world");

      const msgs = useChatStore.getState().messages.get("sess-1");
      expect(msgs).toHaveLength(1);
      expect(msgs![0]!.role).toBe("user");
      expect(msgs![0]!.blocks[0]).toEqual({ type: "text", content: "Hello world" });
      expect(msgs![0]!.id).toBe("test-uuid-1234");
      expect(mockEmit).toHaveBeenCalledWith("chat:send", { prompt: "Hello world" });
    });

    it("does nothing when no active session", () => {
      useChatStore.setState({ activeSessionId: null });

      useChatStore.getState().sendMessage("Hello");

      expect(useChatStore.getState().messages.size).toBe(0);
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("includes attachments when provided", () => {
      useChatStore.setState({ activeSessionId: "sess-1" });
      const attachments = [{ type: "file" as const, path: "/tmp/test.txt" }];

      useChatStore.getState().sendMessage("Check this file", attachments);

      const msgs = useChatStore.getState().messages.get("sess-1");
      expect(msgs![0]!.attachments).toEqual(attachments);
      expect(mockEmit).toHaveBeenCalledWith("chat:send", {
        prompt: "Check this file",
        attachments,
      });
    });
  });

  describe("cancelGeneration", () => {
    it("emits chat:cancel event", () => {
      useChatStore.getState().cancelGeneration();

      expect(mockEmit).toHaveBeenCalledWith("chat:cancel", {});
    });
  });

  describe("setModel", () => {
    it("updates selected model", () => {
      useChatStore.getState().setModel("claude-4");

      expect(useChatStore.getState().selectedModel).toBe("claude-4");
    });
  });

  describe("setEffort", () => {
    it("updates selected effort", () => {
      useChatStore.getState().setEffort("high");

      expect(useChatStore.getState().selectedEffort).toBe("high");
    });
  });

  describe("setActiveSession", () => {
    it("updates active session ID", () => {
      useChatStore.getState().setActiveSession("sess-42");

      expect(useChatStore.getState().activeSessionId).toBe("sess-42");
    });

    it("can set to null", () => {
      useChatStore.setState({ activeSessionId: "sess-1" });

      useChatStore.getState().setActiveSession(null);

      expect(useChatStore.getState().activeSessionId).toBeNull();
    });
  });

  describe("appendMessage", () => {
    it("adds message to session message list", () => {
      const message = {
        id: "msg-1",
        role: "assistant" as const,
        blocks: [{ type: "text" as const, content: "Hi there!" }],
        timestamp: "2026-01-01T00:00:00Z",
        isStreaming: false,
      };

      useChatStore.getState().appendMessage("sess-1", message);

      const msgs = useChatStore.getState().messages.get("sess-1");
      expect(msgs).toHaveLength(1);
      expect(msgs![0]).toEqual(message);
    });

    it("appends to existing messages", () => {
      const existing = {
        id: "msg-1",
        role: "user" as const,
        blocks: [{ type: "text" as const, content: "Hello" }],
        timestamp: "2026-01-01T00:00:00Z",
        isStreaming: false,
      };
      const messages = new Map();
      messages.set("sess-1", [existing]);
      useChatStore.setState({ messages });

      const newMsg = {
        id: "msg-2",
        role: "assistant" as const,
        blocks: [{ type: "text" as const, content: "Hi!" }],
        timestamp: "2026-01-01T00:00:01Z",
        isStreaming: false,
      };
      useChatStore.getState().appendMessage("sess-1", newMsg);

      const msgs = useChatStore.getState().messages.get("sess-1");
      expect(msgs).toHaveLength(2);
      expect(msgs![1]).toEqual(newMsg);
    });

    it("sets hasNewMessages when user is scrolled up", () => {
      useChatStore.setState({ isUserScrolledUp: true });
      const message = {
        id: "msg-1",
        role: "assistant" as const,
        blocks: [{ type: "text" as const, content: "Update" }],
        timestamp: "2026-01-01T00:00:00Z",
        isStreaming: false,
      };

      useChatStore.getState().appendMessage("sess-1", message);

      expect(useChatStore.getState().hasNewMessages).toBe(true);
    });
  });

  describe("resumeSession", () => {
    it("sets messages from API response", async () => {
      const serverMessages = [
        { id: "msg-1", role: "assistant" as const, blocks: [{ type: "text" as const, content: "Hello" }], timestamp: "2026-01-01T00:00:00Z", isStreaming: false },
      ];
      mockApiPost.mockResolvedValueOnce({
        data: { messages: serverMessages },
        error: null,
        status: 200,
      });

      await useChatStore.getState().resumeSession("proj-1", "sess-1");

      expect(mockApiPost).toHaveBeenCalledWith("/api/proj-1/chat/sessions/sess-1/resume", {});
      expect(useChatStore.getState().messages.get("sess-1")).toEqual(serverMessages);
      expect(useChatStore.getState().activeSessionId).toBe("sess-1");
    });

    it("does not overwrite messages during active streaming", async () => {
      const localMessages = new Map();
      localMessages.set("sess-1", [
        { id: "local-msg", role: "assistant" as const, blocks: [], timestamp: "2026-01-01T00:00:00Z", isStreaming: true },
      ]);
      useChatStore.setState({ isStreaming: true, messages: localMessages });

      mockApiPost.mockResolvedValueOnce({
        data: { messages: [{ id: "server-msg", role: "user" as const, blocks: [], timestamp: "2026-01-01T00:00:00Z", isStreaming: false }] },
        error: null,
        status: 200,
      });

      await useChatStore.getState().resumeSession("proj-1", "sess-1");

      // Local streaming messages should be preserved
      expect(useChatStore.getState().messages.get("sess-1")![0]!.id).toBe("local-msg");
    });

    it("does not overwrite local messages with empty server response", async () => {
      const localMessages = new Map();
      localMessages.set("sess-1", [
        { id: "local-msg", role: "user" as const, blocks: [{ type: "text" as const, content: "hi" }], timestamp: "2026-01-01T00:00:00Z", isStreaming: false },
      ]);
      useChatStore.setState({ messages: localMessages });

      mockApiPost.mockResolvedValueOnce({
        data: { messages: [] },
        error: null,
        status: 200,
      });

      await useChatStore.getState().resumeSession("proj-1", "sess-1");

      // Should keep local messages since server returned empty
      expect(useChatStore.getState().messages.get("sess-1")![0]!.id).toBe("local-msg");
    });
  });

  describe("renameSession", () => {
    it("updates session title in store", () => {
      useChatStore.setState({
        sessions: [
          { id: "sess-1", projectId: "proj-1", model: "claude-3", createdAt: "2026-01-01T00:00:00Z", messageCount: 1, title: "Old Title" },
          { id: "sess-2", projectId: "proj-1", model: "claude-3", createdAt: "2026-01-01T00:00:00Z", messageCount: 1 },
        ],
      });

      useChatStore.getState().renameSession("sess-1", "New Title");

      expect(useChatStore.getState().sessions[0]!.title).toBe("New Title");
      expect(useChatStore.getState().sessions[1]!.title).toBeUndefined();
    });
  });

  describe("scrollToBottom", () => {
    it("resets scroll state", () => {
      useChatStore.setState({ isUserScrolledUp: true, hasNewMessages: true });

      useChatStore.getState().scrollToBottom();

      expect(useChatStore.getState().isUserScrolledUp).toBe(false);
      expect(useChatStore.getState().hasNewMessages).toBe(false);
    });
  });

  describe("setUserScrolledUp", () => {
    it("sets the scroll state", () => {
      useChatStore.getState().setUserScrolledUp(true);
      expect(useChatStore.getState().isUserScrolledUp).toBe(true);

      useChatStore.getState().setUserScrolledUp(false);
      expect(useChatStore.getState().isUserScrolledUp).toBe(false);
    });
  });

  describe("clearStreamingState", () => {
    it("resets all streaming-related fields", () => {
      useChatStore.setState({
        streamingContent: "some content",
        streamingReasoning: "some reasoning",
        streamingReasoningTokens: 42,
        isStreaming: true,
        isThinking: true,
        ttftMs: 123,
      });

      useChatStore.getState().clearStreamingState();

      const state = useChatStore.getState();
      expect(state.streamingContent).toBe("");
      expect(state.streamingReasoning).toBe("");
      expect(state.streamingReasoningTokens).toBe(0);
      expect(state.isStreaming).toBe(false);
      expect(state.isThinking).toBe(false);
      expect(state.ttftMs).toBeNull();
    });
  });

  describe("updateLastAssistantBlock", () => {
    it("updates the last block of the last assistant message", () => {
      const messages = new Map();
      messages.set("sess-1", [
        {
          id: "msg-1",
          role: "assistant" as const,
          blocks: [{ type: "text" as const, content: "Old content" }],
          timestamp: "2026-01-01T00:00:00Z",
          isStreaming: true,
        },
      ]);
      useChatStore.setState({ messages });

      useChatStore.getState().updateLastAssistantBlock("sess-1", { type: "text", content: "Updated content" });

      const msgs = useChatStore.getState().messages.get("sess-1")!;
      expect(msgs[0]!.blocks[0]).toEqual({ type: "text", content: "Updated content" });
    });

    it("does nothing when no messages exist", () => {
      useChatStore.getState().updateLastAssistantBlock("sess-1", { type: "text", content: "test" });
      expect(useChatStore.getState().messages.get("sess-1")).toBeUndefined();
    });

    it("does nothing when last message is not assistant", () => {
      const messages = new Map();
      messages.set("sess-1", [
        { id: "msg-1", role: "user" as const, blocks: [{ type: "text" as const, content: "hello" }], timestamp: "2026-01-01T00:00:00Z", isStreaming: false },
      ]);
      useChatStore.setState({ messages });

      useChatStore.getState().updateLastAssistantBlock("sess-1", { type: "text", content: "test" });

      const msgs = useChatStore.getState().messages.get("sess-1")!;
      expect(msgs[0]!.blocks[0]).toEqual({ type: "text", content: "hello" });
    });
  });

  describe("finalizeAssistantMessage", () => {
    it("finalizes streaming message with content", () => {
      const messages = new Map();
      messages.set("sess-1", [
        {
          id: "msg-1",
          role: "assistant" as const,
          blocks: [],
          timestamp: "2026-01-01T00:00:00Z",
          isStreaming: true,
        },
      ]);
      useChatStore.setState({
        messages,
        isStreaming: true,
        streamingContent: "Hello world",
        streamingReasoning: "",
      });

      useChatStore.getState().finalizeAssistantMessage("sess-1");

      const state = useChatStore.getState();
      expect(state.isStreaming).toBe(false);
      const msgs = state.messages.get("sess-1")!;
      expect(msgs[0]!.isStreaming).toBe(false);
      const textBlock = msgs[0]!.blocks.find((b) => b.type === "text");
      expect(textBlock).toBeDefined();
    });

    it("uses fallback content when no streaming content", () => {
      const messages = new Map();
      messages.set("sess-1", [
        {
          id: "msg-1",
          role: "assistant" as const,
          blocks: [],
          timestamp: "2026-01-01T00:00:00Z",
          isStreaming: true,
        },
      ]);
      useChatStore.setState({
        messages,
        isStreaming: true,
        streamingContent: "",
        streamingReasoning: "",
      });

      useChatStore.getState().finalizeAssistantMessage("sess-1", "Fallback text");

      const msgs = useChatStore.getState().messages.get("sess-1")!;
      const textBlock = msgs[0]!.blocks.find((b) => b.type === "text");
      expect(textBlock).toBeDefined();
      if (textBlock && textBlock.type === "text") {
        expect(textBlock.content).toBe("Fallback text");
      }
    });

    it("does nothing when not streaming", () => {
      useChatStore.setState({ isStreaming: false });

      useChatStore.getState().finalizeAssistantMessage("sess-1");

      // Should not throw or change state
      expect(useChatStore.getState().isStreaming).toBe(false);
    });

    it("handles reasoning content during finalization", () => {
      const messages = new Map();
      messages.set("sess-1", [
        {
          id: "msg-1",
          role: "assistant" as const,
          blocks: [],
          timestamp: "2026-01-01T00:00:00Z",
          isStreaming: true,
        },
      ]);
      useChatStore.setState({
        messages,
        isStreaming: true,
        streamingContent: "Answer",
        streamingReasoning: "Thinking...",
      });

      useChatStore.getState().finalizeAssistantMessage("sess-1");

      const msgs = useChatStore.getState().messages.get("sess-1")!;
      const reasoningBlock = msgs[0]!.blocks.find((b) => b.type === "reasoning");
      expect(reasoningBlock).toBeDefined();
    });
  });

  describe("reviseTo", () => {
    it("sets revision draft from user message", () => {
      const messages = new Map();
      messages.set("sess-1", [
        { id: "msg-1", role: "user" as const, blocks: [{ type: "text" as const, content: "Original question" }], timestamp: "2026-01-01T00:00:00Z", isStreaming: false },
        { id: "msg-2", role: "assistant" as const, blocks: [{ type: "text" as const, content: "Answer" }], timestamp: "2026-01-01T00:00:01Z", isStreaming: false },
      ]);
      useChatStore.setState({ activeSessionId: "sess-1", messages });

      useChatStore.getState().reviseTo(0);

      expect(useChatStore.getState().revisionDraft).toBe("Original question");
      expect(useChatStore.getState().revisionSourceIndex).toBe(0);
    });

    it("does nothing when no active session", () => {
      useChatStore.setState({ activeSessionId: null });

      useChatStore.getState().reviseTo(0);

      expect(useChatStore.getState().revisionDraft).toBeNull();
    });

    it("does nothing when message is not a user message", () => {
      const messages = new Map();
      messages.set("sess-1", [
        { id: "msg-1", role: "assistant" as const, blocks: [{ type: "text" as const, content: "Answer" }], timestamp: "2026-01-01T00:00:00Z", isStreaming: false },
      ]);
      useChatStore.setState({ activeSessionId: "sess-1", messages });

      useChatStore.getState().reviseTo(0);

      expect(useChatStore.getState().revisionDraft).toBeNull();
    });

    it("does nothing for out of range index", () => {
      const messages = new Map();
      messages.set("sess-1", []);
      useChatStore.setState({ activeSessionId: "sess-1", messages });

      useChatStore.getState().reviseTo(5);

      expect(useChatStore.getState().revisionDraft).toBeNull();
    });
  });

  describe("setAutopilot", () => {
    it("enables autopilot", () => {
      useChatStore.getState().setAutopilot(true);
      expect(useChatStore.getState().autopilot).toBe(true);
    });

    it("disables autopilot", () => {
      useChatStore.setState({ autopilot: true });
      useChatStore.getState().setAutopilot(false);
      expect(useChatStore.getState().autopilot).toBe(false);
    });
  });

  describe("respondToPermission", () => {
    it("emits approved decision and clears pending", () => {
      useChatStore.setState({
        pendingPermission: { requestId: "req-1", title: "t", message: "m", permissionKind: "shell" },
      });

      useChatStore.getState().respondToPermission("req-1", true);

      expect(mockEmit).toHaveBeenCalledWith("chat:permission", {
        requestId: "req-1",
        decision: { kind: "approved" },
      });
      expect(useChatStore.getState().pendingPermission).toBeNull();
    });

    it("emits denied decision", () => {
      useChatStore.setState({
        pendingPermission: { requestId: "req-1", title: "t", message: "m", permissionKind: "shell" },
      });

      useChatStore.getState().respondToPermission("req-1", false);

      expect(mockEmit).toHaveBeenCalledWith("chat:permission", {
        requestId: "req-1",
        decision: { kind: "denied-interactively-by-user" },
      });
    });
  });

  describe("respondToInput", () => {
    it("emits input response and clears pending", () => {
      useChatStore.setState({
        pendingInput: { requestId: "req-2", prompt: "Enter value" },
      });

      useChatStore.getState().respondToInput("req-2", "my answer");

      expect(mockEmit).toHaveBeenCalledWith("chat:input", {
        requestId: "req-2",
        answer: "my answer",
      });
      expect(useChatStore.getState().pendingInput).toBeNull();
    });
  });

  describe("respondToElicitation", () => {
    it("emits elicitation response and clears pending", () => {
      useChatStore.setState({
        pendingElicitation: { requestId: "req-3", schema: { type: "object" } },
      });

      useChatStore.getState().respondToElicitation("req-3", { name: "test" });

      expect(mockEmit).toHaveBeenCalledWith("chat:elicitation", {
        requestId: "req-3",
        data: { name: "test" },
      });
      expect(useChatStore.getState().pendingElicitation).toBeNull();
    });
  });

  describe("exported helpers", () => {
    it("onTurnStart sets streaming state", async () => {
      const { onTurnStart } = await import("./chat-store");

      onTurnStart();

      expect(useChatStore.getState().isStreaming).toBe(true);
      expect(useChatStore.getState().streamingContent).toBe("");
      expect(useChatStore.getState().streamingReasoning).toBe("");
      expect(useChatStore.getState().ttftMs).toBeNull();
    });

    it("onVisibilityChange flushes buffers when document becomes visible", async () => {
      const { onMessageDelta, onVisibilityChange } = await import("./chat-store");

      // Queue a delta
      onMessageDelta("hello");

      // Simulate visibility change
      Object.defineProperty(document, "hidden", { value: false, writable: true, configurable: true });
      onVisibilityChange();

      // After flush the content should be updated
      // Need to wait for any sync operations
      expect(useChatStore.getState().streamingContent).toContain("hello");
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      const messages = new Map();
      messages.set("sess-1", [
        { id: "msg-1", role: "user" as const, blocks: [{ type: "text" as const, content: "hello" }], timestamp: "2026-01-01T00:00:00Z", isStreaming: false },
      ]);
      useChatStore.setState({
        sessions: [
          { id: "sess-1", projectId: "proj-1", model: "claude-3", reasoningEffort: "medium" as const, createdAt: "2026-01-01T00:00:00Z", messageCount: 1 },
        ],
        activeSessionId: "sess-1",
        messages,
        isStreaming: true,
        sessionError: "some error",
        contextWindowPct: 50,
        isUserScrolledUp: true,
        hasNewMessages: true,
      });

      useChatStore.getState().reset();

      const state = useChatStore.getState();
      expect(state.sessions).toEqual([]);
      expect(state.sessionsFetched).toBe(false);
      expect(state.activeSessionId).toBeNull();
      expect(state.messages.size).toBe(0);
      expect(state.isStreaming).toBe(false);
      expect(state.streamingContent).toBe("");
      expect(state.streamingReasoning).toBe("");
      expect(state.sessionError).toBeNull();
      expect(state.contextWindowPct).toBe(0);
      expect(state.isUserScrolledUp).toBe(false);
      expect(state.hasNewMessages).toBe(false);
      expect(state.pendingPermission).toBeNull();
      expect(state.pendingInput).toBeNull();
      expect(state.pendingElicitation).toBeNull();
      expect(state.revisionDraft).toBeNull();
      expect(state.revisionSourceIndex).toBeNull();
      expect(state.pendingInitialMessage).toBeNull();
    });
  });
});
