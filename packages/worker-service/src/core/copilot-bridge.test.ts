import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockClientStart = vi.fn().mockResolvedValue(undefined);
const mockClientStop = vi.fn().mockResolvedValue(undefined);
const mockClientForceStop = vi.fn().mockResolvedValue(undefined);
const mockClientListModels = vi.fn().mockResolvedValue([]);
const mockClientCreateSession = vi.fn();
const mockClientResumeSession = vi.fn();
const mockClientListSessions = vi.fn().mockResolvedValue([]);
const mockClientDeleteSession = vi.fn().mockResolvedValue(undefined);

vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: vi.fn().mockImplementation(() => ({
    start: mockClientStart,
    stop: mockClientStop,
    forceStop: mockClientForceStop,
    listModels: mockClientListModels,
    createSession: mockClientCreateSession,
    resumeSession: mockClientResumeSession,
    listSessions: mockClientListSessions,
    deleteSession: mockClientDeleteSession,
  })),
}));

vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./event-bus.js", () => ({
  eventBus: {
    publish: vi.fn(),
  },
}));

vi.mock("./context-recipe-engine.js", () => ({
  assemble: vi.fn().mockResolvedValue({ content: "assembled context" }),
}));

vi.mock("./chat-builtin-tools.js", () => ({
  getBuiltinTools: vi.fn().mockReturnValue([]),
}));

vi.mock("../routes/projects.js", () => ({
  getRegistry: vi.fn().mockReturnValue(
    new Map([
      [
        "proj-1",
        {
          name: "Test Project",
          path: "/tmp/project",
          mountedExtensions: [],
        },
      ],
    ]),
  ),
}));

vi.mock("./extension-registry.js", () => ({
  listMounted: vi.fn().mockReturnValue([]),
}));

vi.mock("./extension-circuit-breaker.js", () => ({
  circuitBreaker: {
    isSuspended: vi.fn().mockReturnValue(false),
  },
}));

vi.mock("./server-port.js", () => ({
  getServerPort: vi.fn().mockReturnValue(42888),
}));

// ---------------------------------------------------------------------------
// Import module under test (after mocks)
// ---------------------------------------------------------------------------

import { CopilotBridge } from "./copilot-bridge.js";
import { eventBus } from "./event-bus.js";
import { listMounted } from "./extension-registry.js";
import { circuitBreaker } from "./extension-circuit-breaker.js";
import { getRegistry as getProjectRegistry } from "../routes/projects.js";
import { assemble } from "./context-recipe-engine.js";
import { getBuiltinTools } from "./chat-builtin-tools.js";
import { getServerPort } from "./server-port.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: overrides["sessionId"] ?? "session-123",
    send: vi.fn().mockResolvedValue("msg-1"),
    abort: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    registerTools: vi.fn(),
    ...overrides,
  };
}

function createMockIO() {
  const toFn = vi.fn().mockReturnValue({ emit: vi.fn() });
  return {
    to: toFn,
    emit: vi.fn(),
    _toFn: toFn,
  } as unknown as ReturnType<typeof createMockIO> & { to: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; _toFn: ReturnType<typeof vi.fn> };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CopilotBridge", () => {
  let bridge: CopilotBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks resets call history but NOT implementations.
    // Reset specific mocks that tests override, to prevent leakage.
    mockClientStart.mockResolvedValue(undefined);
    mockClientStop.mockResolvedValue(undefined);
    mockClientForceStop.mockResolvedValue(undefined);
    mockClientListModels.mockResolvedValue([]);
    mockClientListSessions.mockResolvedValue([]);
    mockClientDeleteSession.mockResolvedValue(undefined);
    vi.mocked(listMounted).mockReturnValue([]);
    vi.mocked(circuitBreaker.isSuspended).mockReturnValue(false);
    vi.mocked(getProjectRegistry).mockReturnValue(
      new Map([
        [
          "proj-1",
          {
            name: "Test Project",
            path: "/tmp/project",
            mountedExtensions: [],
          },
        ],
      ]) as any,
    );
    bridge = new CopilotBridge();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // getStatus
  // =========================================================================
  describe("getStatus", () => {
    it("returns not-initialized state by default", () => {
      const status = bridge.getStatus();
      expect(status.status).toBe("not-initialized");
      expect(status.sessionCount).toBe(0);
      expect(status.models).toEqual([]);
      expect(status.error).toBeUndefined();
    });
  });

  // =========================================================================
  // ensureStarted / doStart
  // =========================================================================
  describe("ensureStarted", () => {
    it("starts the CopilotClient successfully", async () => {
      await bridge.ensureStarted();
      expect(mockClientStart).toHaveBeenCalledOnce();
      expect(bridge.getStatus().status).toBe("ready");
    });

    it("does not start again if already ready", async () => {
      await bridge.ensureStarted();
      await bridge.ensureStarted();
      expect(mockClientStart).toHaveBeenCalledOnce();
    });

    it("becomes unavailable after all retries fail", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });

      mockClientStart.mockRejectedValue(new Error("connection failed"));

      let rejected = false;
      let rejectionError: Error | undefined;
      const p = bridge.ensureStarted().catch((err) => {
        rejected = true;
        rejectionError = err;
      });

      // The doStart loop: attempt 0 fails, sleep(1000), attempt 1 fails, sleep(5000), attempt 2 fails, sleep(15000), attempt 3 fails, throw
      // Advance through each sleep interval and then some
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.advanceTimersByTimeAsync(1_000); // Extra to flush

      await p;

      expect(rejected).toBe(true);
      expect(rejectionError?.message).toBe("Copilot SDK unavailable after retries");
      // 1 initial + 3 retries = 4 total
      expect(mockClientStart).toHaveBeenCalledTimes(4);
      expect(bridge.getStatus().status).toBe("unavailable");

      vi.useRealTimers();
    });

    it("throws immediately when state is unavailable", async () => {
      // Force unavailable state by setting it directly
      (bridge as any).state = "unavailable";

      await expect(bridge.ensureStarted()).rejects.toThrow(
        "Copilot SDK is unavailable",
      );
    });

    it("deduplicates concurrent start attempts", async () => {
      const p1 = bridge.ensureStarted();
      const p2 = bridge.ensureStarted();
      await Promise.all([p1, p2]);
      expect(mockClientStart).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // setIO and emitToSession
  // =========================================================================
  describe("setIO / emitToSession", () => {
    it("emits to the correct socket room after setIO", async () => {
      const mockIO = createMockIO();
      bridge.setIO(mockIO as any);

      // Start and create a session to trigger emitToSession via events
      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);
      mockClientListModels.mockResolvedValue([]);

      await bridge.ensureStarted();
      await bridge.createChatSession({ projectId: "proj-1" });

      // emitBridgeStatus should have been called
      expect(mockIO.emit).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Session event listeners
  // =========================================================================
  describe("addSessionEventListener / removeSessionEventListener", () => {
    it("adds and invokes a listener", async () => {
      const mockIO = createMockIO();
      bridge.setIO(mockIO as any);
      await bridge.ensureStarted();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      const sessionId = await bridge.createChatSession({ projectId: "proj-1" });

      const listener = vi.fn();
      bridge.addSessionEventListener(sessionId, listener);

      // Trigger an event through the SDK event handler
      const onHandler = mockSession.on.mock.calls[0]?.[0];
      expect(onHandler).toBeDefined();

      // Simulate a message event
      onHandler({ type: "assistant.message", data: { content: "hello" } });
      expect(listener).toHaveBeenCalledWith("message", expect.objectContaining({ content: "hello" }));
    });

    it("removes a listener", async () => {
      const mockIO = createMockIO();
      bridge.setIO(mockIO as any);
      await bridge.ensureStarted();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      const sessionId = await bridge.createChatSession({ projectId: "proj-1" });

      const listener = vi.fn();
      bridge.addSessionEventListener(sessionId, listener);
      bridge.removeSessionEventListener(sessionId, listener);

      const onHandler = mockSession.on.mock.calls[0]?.[0];
      onHandler({ type: "assistant.message", data: { content: "hello" } });
      expect(listener).not.toHaveBeenCalled();
    });

    it("removeSessionEventListener is a no-op for unknown session", () => {
      expect(() => bridge.removeSessionEventListener("unknown", vi.fn())).not.toThrow();
    });

    it("listener errors do not break event dispatch", async () => {
      const mockIO = createMockIO();
      bridge.setIO(mockIO as any);
      await bridge.ensureStarted();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      const sessionId = await bridge.createChatSession({ projectId: "proj-1" });

      const badListener = vi.fn().mockImplementation(() => { throw new Error("boom"); });
      const goodListener = vi.fn();
      bridge.addSessionEventListener(sessionId, badListener);
      bridge.addSessionEventListener(sessionId, goodListener);

      const onHandler = mockSession.on.mock.calls[0]?.[0];
      onHandler({ type: "assistant.message", data: { content: "test" } });

      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // listModels
  // =========================================================================
  describe("listModels", () => {
    it("returns models and populates cache", async () => {
      const models = [
        { id: "gpt-4", capabilities: { supports: { reasoningEffort: true } } },
        { id: "gpt-3.5", capabilities: { supports: { reasoningEffort: false } } },
      ];
      mockClientListModels.mockResolvedValue(models);
      await bridge.ensureStarted();

      const result = await bridge.listModels();
      expect(result).toEqual(models);
    });
  });

  // =========================================================================
  // createChatSession
  // =========================================================================
  describe("createChatSession", () => {
    beforeEach(async () => {
      await bridge.ensureStarted();
    });

    it("creates a session and returns session ID", async () => {
      const mockSession = createMockSession({ sessionId: "new-sess" });
      mockClientCreateSession.mockResolvedValue(mockSession);

      const sessionId = await bridge.createChatSession({ projectId: "proj-1" });
      expect(sessionId).toBe("new-sess");
      expect(mockSession.registerTools).toHaveBeenCalled();
      expect(mockSession.on).toHaveBeenCalled();
      expect(eventBus.publish).toHaveBeenCalledWith("session:started", expect.objectContaining({ sessionId: "new-sess" }));
    });

    it("retries without reasoningEffort when model does not support it", async () => {
      const err = new Error("Model does not support reasoning effort");
      mockClientCreateSession
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce(createMockSession());

      // Pre-populate model cache with a model that claims reasoning support
      const models = [{ id: "model-x", capabilities: { supports: { reasoningEffort: true } } }];
      mockClientListModels.mockResolvedValue(models);
      await bridge.listModels();

      const sessionId = await bridge.createChatSession({
        projectId: "proj-1",
        model: "model-x",
        reasoningEffort: "high",
      });

      expect(mockClientCreateSession).toHaveBeenCalledTimes(2);
      expect(sessionId).toBeDefined();
    });

    it("throws non-reasoning errors without retry", async () => {
      mockClientCreateSession.mockRejectedValue(new Error("quota exceeded"));

      await expect(
        bridge.createChatSession({ projectId: "proj-1" }),
      ).rejects.toThrow("quota exceeded");
      expect(mockClientCreateSession).toHaveBeenCalledOnce();
    });

    it("replays branch context (user messages only)", async () => {
      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      await bridge.createChatSession({
        projectId: "proj-1",
        context: [
          { role: "user", content: "first" },
          { role: "assistant", content: "response" },
          { role: "user", content: "second" },
        ],
      });

      // Only user messages get replayed
      expect(mockSession.send).toHaveBeenCalledTimes(2);
      expect(mockSession.send).toHaveBeenCalledWith({ prompt: "first" });
      expect(mockSession.send).toHaveBeenCalledWith({ prompt: "second" });
    });

    it("includes title in system prompt when provided", async () => {
      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      await bridge.createChatSession({
        projectId: "proj-1",
        title: "Debug task",
      });

      const config = mockClientCreateSession.mock.calls[0]?.[0];
      expect(config.systemMessage.content).toContain("# Debug task");
    });

    it("sets workingDirectory from project path", async () => {
      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      await bridge.createChatSession({ projectId: "proj-1" });

      const config = mockClientCreateSession.mock.calls[0]?.[0];
      expect(config.workingDirectory).toBe("/tmp/project");
    });
  });

  // =========================================================================
  // Extension tools & agents registration
  // =========================================================================
  describe("extension tools and agents registration", () => {
    beforeEach(async () => {
      await bridge.ensureStarted();
    });

    it("registers extension chat tools for mounted extensions with llm permission", async () => {
      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      vi.mocked(listMounted).mockReturnValue([
        {
          name: "my-ext",
          version: "1.0.0",
          status: "mounted",
          manifest: {
            permissions: { llm: true },
            displayName: "My Extension",
            chatTools: [
              {
                name: "search",
                description: "Search things",
                endpoint: "POST /search",
                parameters: { query: { type: "string" } },
              },
            ],
            chatAgents: [],
          },
        } as any,
      ]);

      await bridge.createChatSession({ projectId: "proj-1" });

      // registerTools called twice: once for builtin, once for extension
      expect(mockSession.registerTools).toHaveBeenCalledTimes(2);
      const extToolsCall = mockSession.registerTools.mock.calls[1]?.[0];
      expect(extToolsCall).toHaveLength(1);
      expect(extToolsCall[0].name).toBe("my-ext__search");
      expect(extToolsCall[0].description).toContain("[My Extension]");
    });

    it("skips extensions without llm permission", async () => {
      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      vi.mocked(listMounted).mockReturnValue([
        {
          name: "no-llm",
          version: "1.0.0",
          status: "mounted",
          manifest: {
            permissions: { llm: false },
            chatTools: [{ name: "t", description: "d", endpoint: "POST /t", parameters: {} }],
          },
        } as any,
      ]);

      await bridge.createChatSession({ projectId: "proj-1" });
      // Only the builtin tools registration
      expect(mockSession.registerTools).toHaveBeenCalledTimes(1);
    });

    it("skips suspended extensions", async () => {
      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      vi.mocked(circuitBreaker.isSuspended).mockReturnValue(true);
      vi.mocked(listMounted).mockReturnValue([
        {
          name: "suspended-ext",
          version: "1.0.0",
          status: "mounted",
          manifest: {
            permissions: { llm: true },
            chatTools: [{ name: "t", description: "d", endpoint: "POST /t", parameters: {} }],
          },
        } as any,
      ]);

      await bridge.createChatSession({ projectId: "proj-1" });
      expect(mockSession.registerTools).toHaveBeenCalledTimes(1);
    });

    it("skips tools with invalid endpoint format", async () => {
      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      vi.mocked(listMounted).mockReturnValue([
        {
          name: "bad-ext",
          version: "1.0.0",
          status: "mounted",
          manifest: {
            permissions: { llm: true },
            displayName: "Bad",
            chatTools: [
              { name: "good", description: "ok", endpoint: "POST /good", parameters: {} },
              { name: "bad", description: "no", endpoint: "invalid", parameters: {} },
            ],
            chatAgents: [],
          },
        } as any,
      ]);

      await bridge.createChatSession({ projectId: "proj-1" });
      const extToolsCall = mockSession.registerTools.mock.calls[1]?.[0];
      expect(extToolsCall).toHaveLength(1);
      expect(extToolsCall[0].name).toBe("bad-ext__good");
    });

    it("registers chat agents with namespaced tool references", async () => {
      const mockSession = createMockSession();
      const registerCustomAgent = vi.fn();
      (mockSession as any).registerCustomAgent = registerCustomAgent;
      mockClientCreateSession.mockResolvedValue(mockSession);

      vi.mocked(listMounted).mockReturnValue([
        {
          name: "agent-ext",
          version: "1.0.0",
          status: "mounted",
          manifest: {
            permissions: { llm: true },
            displayName: "Agent Ext",
            chatTools: [
              { name: "tool-a", description: "desc", endpoint: "POST /a", parameters: {} },
            ],
            chatAgents: [
              {
                name: "my-agent",
                displayName: "My Agent",
                description: "An agent",
                prompt: "Be helpful",
                tools: ["tool-a"],
              },
            ],
          },
        } as any,
      ]);

      await bridge.createChatSession({ projectId: "proj-1" });

      expect(registerCustomAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "agent-ext__my-agent",
          tools: ["agent-ext__tool-a"],
        }),
      );
    });

    it("skips agents referencing invalid tools", async () => {
      const mockSession = createMockSession();
      const registerCustomAgent = vi.fn();
      (mockSession as any).registerCustomAgent = registerCustomAgent;
      mockClientCreateSession.mockResolvedValue(mockSession);

      vi.mocked(listMounted).mockReturnValue([
        {
          name: "agent-ext",
          version: "1.0.0",
          status: "mounted",
          manifest: {
            permissions: { llm: true },
            displayName: "Agent Ext",
            chatTools: [
              { name: "tool-a", description: "desc", endpoint: "POST /a", parameters: {} },
            ],
            chatAgents: [
              {
                name: "bad-agent",
                displayName: "Bad Agent",
                description: "An agent",
                prompt: "Do stuff",
                tools: ["nonexistent-tool"],
              },
            ],
          },
        } as any,
      ]);

      await bridge.createChatSession({ projectId: "proj-1" });
      expect(registerCustomAgent).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // sendMessage
  // =========================================================================
  describe("sendMessage", () => {
    it("sends prompt to the SDK session", async () => {
      const mockIO = createMockIO();
      bridge.setIO(mockIO as any);
      await bridge.ensureStarted();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);
      const sessionId = await bridge.createChatSession({ projectId: "proj-1" });

      await bridge.sendMessage(sessionId, "Hello");

      expect(mockSession.send).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "Hello" }),
      );
    });

    it("throws for unknown session", async () => {
      await bridge.ensureStarted();
      await expect(bridge.sendMessage("unknown", "hi")).rejects.toThrow(
        "Session unknown not found",
      );
    });

    it("maps file and directory attachments", async () => {
      const mockIO = createMockIO();
      bridge.setIO(mockIO as any);
      await bridge.ensureStarted();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);
      const sessionId = await bridge.createChatSession({ projectId: "proj-1" });

      await bridge.sendMessage(sessionId, "Check this", [
        { type: "file", path: "/a/b.ts", displayName: "b.ts" },
        { type: "directory", path: "/a/dir" },
        { type: "selection", path: "/a/c.ts" },
      ]);

      const opts = mockSession.send.mock.calls[0]?.[0];
      expect(opts.attachments).toHaveLength(3);
      expect(opts.attachments[0]).toEqual({ type: "file", path: "/a/b.ts", displayName: "b.ts" });
      expect(opts.attachments[1]).toEqual({ type: "directory", path: "/a/dir" });
      // selection maps to file
      expect(opts.attachments[2].type).toBe("file");
    });

    it("emits turn-start before sending and sets suppressNextTurnStart", async () => {
      const mockIO = createMockIO();
      bridge.setIO(mockIO as any);
      await bridge.ensureStarted();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);
      const sessionId = await bridge.createChatSession({ projectId: "proj-1" });

      await bridge.sendMessage(sessionId, "Hello");

      // Check that turn-start was emitted via io.to
      const toCalls = mockIO.to.mock.calls;
      const turnStartEmit = toCalls.find(
        (call: any[]) => call[0] === `chat:${sessionId}`,
      );
      expect(turnStartEmit).toBeDefined();
    });
  });

  // =========================================================================
  // cancelGeneration
  // =========================================================================
  describe("cancelGeneration", () => {
    it("aborts the session and emits idle", async () => {
      const mockIO = createMockIO();
      bridge.setIO(mockIO as any);
      await bridge.ensureStarted();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);
      const sessionId = await bridge.createChatSession({ projectId: "proj-1" });

      await bridge.cancelGeneration(sessionId);
      expect(mockSession.abort).toHaveBeenCalled();
    });

    it("throws for unknown session", async () => {
      await bridge.ensureStarted();
      await expect(bridge.cancelGeneration("nope")).rejects.toThrow(
        "Session nope not found",
      );
    });
  });

  // =========================================================================
  // resumeSession
  // =========================================================================
  describe("resumeSession", () => {
    it("resumes an already-tracked session", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession({ sessionId: "existing" });
      mockClientCreateSession.mockResolvedValue(mockSession);
      await bridge.createChatSession({ projectId: "proj-1" });

      const result = await bridge.resumeSession("existing", "proj-1");
      expect(result).toEqual({ sessionId: "existing", projectId: "proj-1" });
      // Should not call client.resumeSession since it's already tracked
      expect(mockClientResumeSession).not.toHaveBeenCalled();
    });

    it("resumes from SDK when not tracked locally", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession({ sessionId: "sdk-sess" });
      mockClientResumeSession.mockResolvedValue(mockSession);

      const result = await bridge.resumeSession("sdk-sess", "proj-1");
      expect(result).toEqual({ sessionId: "sdk-sess", projectId: "proj-1" });
      expect(mockClientResumeSession).toHaveBeenCalledWith("sdk-sess", expect.any(Object));
    });

    it("returns null when SDK resume fails", async () => {
      await bridge.ensureStarted();
      mockClientResumeSession.mockRejectedValue(new Error("not found"));

      const result = await bridge.resumeSession("gone", "proj-1");
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // listSessions
  // =========================================================================
  describe("listSessions", () => {
    it("returns in-memory sessions", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession({ sessionId: "s1" });
      mockClientCreateSession.mockResolvedValue(mockSession);
      await bridge.createChatSession({ projectId: "proj-1" });

      const list = await bridge.listSessions("proj-1");
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.find((s) => s["id"] === "s1")).toBeDefined();
    });

    it("merges SDK sessions with in-memory, deduplicating", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession({ sessionId: "s1" });
      mockClientCreateSession.mockResolvedValue(mockSession);
      await bridge.createChatSession({ projectId: "proj-1" });

      mockClientListSessions.mockResolvedValue([
        {
          sessionId: "s1",
          summary: "existing",
          startTime: new Date(),
          modifiedTime: new Date(),
        },
        {
          sessionId: "s2",
          summary: "from SDK",
          startTime: new Date("2025-01-01"),
          modifiedTime: new Date("2025-01-02"),
        },
      ]);

      const list = await bridge.listSessions("proj-1");
      const ids = list.map((s) => s["id"]);
      expect(ids).toContain("s1");
      expect(ids).toContain("s2");
      // s1 should appear only once
      expect(ids.filter((id) => id === "s1")).toHaveLength(1);
    });

    it("filters by project ID", async () => {
      await bridge.ensureStarted();
      const s1 = createMockSession({ sessionId: "s1" });
      mockClientCreateSession.mockResolvedValue(s1);
      await bridge.createChatSession({ projectId: "proj-1" });

      const list = await bridge.listSessions("other-proj");
      // s1 belongs to proj-1, so filtering by other-proj should exclude it
      const inMemory = list.filter((s) => s["id"] === "s1");
      expect(inMemory).toHaveLength(0);
    });

    it("sorts by lastMessageAt descending", async () => {
      await bridge.ensureStarted();
      mockClientListSessions.mockResolvedValue([
        {
          sessionId: "old",
          summary: "old",
          startTime: new Date("2024-01-01"),
          modifiedTime: new Date("2024-01-01"),
        },
        {
          sessionId: "new",
          summary: "new",
          startTime: new Date("2025-06-01"),
          modifiedTime: new Date("2025-06-01"),
        },
      ]);

      const list = await bridge.listSessions();
      expect(list[0]?.["id"]).toBe("new");
      expect(list[1]?.["id"]).toBe("old");
    });
  });

  // =========================================================================
  // getSessionMessages / getSessionMetadata
  // =========================================================================
  describe("getSessionMessages", () => {
    it("returns messages from the SDK session", async () => {
      await bridge.ensureStarted();
      const msgs = [{ type: "message", data: { content: "hi" } }];
      const mockSession = createMockSession({ getMessages: vi.fn().mockReturnValue(msgs) });
      mockClientCreateSession.mockResolvedValue(mockSession);
      const sessionId = await bridge.createChatSession({ projectId: "proj-1" });

      const result = await bridge.getSessionMessages(sessionId);
      expect(result).toEqual(msgs);
    });

    it("throws for unknown session", async () => {
      await expect(bridge.getSessionMessages("nope")).rejects.toThrow();
    });
  });

  describe("getSessionMetadata", () => {
    it("returns metadata for an existing session", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession({ sessionId: "s1" });
      mockClientCreateSession.mockResolvedValue(mockSession);
      await bridge.createChatSession({ projectId: "proj-1", title: "My Chat" });

      const meta = await bridge.getSessionMetadata("s1");
      expect(meta).toMatchObject({
        id: "s1",
        projectId: "proj-1",
        title: "My Chat",
      });
    });

    it("returns null for unknown session", async () => {
      const meta = await bridge.getSessionMetadata("unknown");
      expect(meta).toBeNull();
    });
  });

  // =========================================================================
  // deleteSession
  // =========================================================================
  describe("deleteSession", () => {
    it("disconnects and removes a managed session", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession({ sessionId: "del-1" });
      mockClientCreateSession.mockResolvedValue(mockSession);
      await bridge.createChatSession({ projectId: "proj-1" });

      const result = await bridge.deleteSession("del-1");
      expect(result).toBe(true);
      expect(mockSession.disconnect).toHaveBeenCalled();
      expect(mockClientDeleteSession).toHaveBeenCalledWith("del-1");
      expect(eventBus.publish).toHaveBeenCalledWith("session:ended", expect.objectContaining({ sessionId: "del-1" }));
    });

    it("returns false when session is not in memory and SDK deletion fails", async () => {
      await bridge.ensureStarted();
      mockClientDeleteSession.mockRejectedValue(new Error("not found"));

      const result = await bridge.deleteSession("nonexistent");
      expect(result).toBe(false);
    });

    it("returns true even when SDK deletion fails if session was in memory", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession({ sessionId: "del-2" });
      mockClientCreateSession.mockResolvedValue(mockSession);
      await bridge.createChatSession({ projectId: "proj-1" });
      mockClientDeleteSession.mockRejectedValue(new Error("SDK error"));

      const result = await bridge.deleteSession("del-2");
      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // closeSession
  // =========================================================================
  describe("closeSession", () => {
    it("disconnects without SDK deletion", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession({ sessionId: "eph-1" });
      mockClientCreateSession.mockResolvedValue(mockSession);
      await bridge.createChatSession({ projectId: "proj-1" });

      await bridge.closeSession("eph-1");
      expect(mockSession.disconnect).toHaveBeenCalled();
      expect(mockClientDeleteSession).not.toHaveBeenCalled();
      expect(bridge.getSession("eph-1")).toBeUndefined();
    });

    it("is a no-op for unknown session", async () => {
      await expect(bridge.closeSession("unknown")).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // Permission resolution
  // =========================================================================
  describe("resolvePermission", () => {
    it("resolves a pending permission request", async () => {
      const mockIO = createMockIO();
      bridge.setIO(mockIO as any);
      await bridge.ensureStarted();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);
      const sessionId = await bridge.createChatSession({ projectId: "proj-1" });

      // Extract the permission handler from session config
      const config = mockClientCreateSession.mock.calls[0]?.[0];
      const permHandler = config.onPermissionRequest;

      // Invoke the permission handler (it creates a pending promise)
      const permPromise = permHandler(
        { kind: "custom-tool", toolName: "editFile", description: "Edit a file" },
        { sessionId },
      );

      // Get the requestId from the emit call
      const permEmitCall = mockIO.to.mock.results.find((r: any) => r.value?.emit);
      const emitMock = mockIO.to.mock.results
        .map((r: any) => r.value?.emit)
        .filter(Boolean);
      // Find the permission-request emit
      let requestId: string | undefined;
      for (const emitFn of emitMock) {
        for (const call of emitFn.mock.calls) {
          if (call[0] === "permission-request") {
            requestId = call[1]?.requestId;
          }
        }
      }

      expect(requestId).toBeDefined();
      bridge.resolvePermission(requestId!, { kind: "approved" } as any);

      const result = await permPromise;
      expect((result as any).kind).toBe("approved");
    });

    it("auto-denies after timeout", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      const mockIO = createMockIO();
      bridge.setIO(mockIO as any);

      // With fake timers, CopilotClient.start() resolves immediately (mocked)
      await bridge.ensureStarted();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);
      const sessionId = await bridge.createChatSession({ projectId: "proj-1" });

      const config = mockClientCreateSession.mock.calls[0]?.[0];
      const permHandler = config.onPermissionRequest;

      const permPromise = permHandler(
        { kind: "custom-tool" },
        { sessionId },
      );

      // Advance past the 30s timeout
      await vi.advanceTimersByTimeAsync(31_000);

      const result = await permPromise;
      expect((result as any).kind).toBe("denied-no-approval-rule-and-could-not-request-from-user");
    });

    it("resolvePermission is a no-op for unknown requestId", () => {
      expect(() => bridge.resolvePermission("unknown-id", { kind: "approved" } as any)).not.toThrow();
    });
  });

  // =========================================================================
  // Input resolution
  // =========================================================================
  describe("resolveInput", () => {
    it("resolves a pending input request", async () => {
      const mockIO = createMockIO();
      bridge.setIO(mockIO as any);
      await bridge.ensureStarted();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);
      const sessionId = await bridge.createChatSession({ projectId: "proj-1" });

      // Extract the user input handler from session config
      const configAny = mockClientCreateSession.mock.calls[0]?.[0] as Record<string, unknown>;
      const inputHandler = configAny["onUserInputRequest"] as Function;

      const inputPromise = inputHandler(
        { question: "Pick a color", choices: ["red", "blue"] },
        { sessionId },
      );

      // Find the requestId
      let requestId: string | undefined;
      const emitMocks = mockIO.to.mock.results.map((r: any) => r.value?.emit).filter(Boolean);
      for (const emitFn of emitMocks) {
        for (const call of emitFn.mock.calls) {
          if (call[0] === "input-request") {
            requestId = call[1]?.requestId;
          }
        }
      }

      expect(requestId).toBeDefined();
      bridge.resolveInput(requestId!, { answer: "red", wasFreeform: false });

      const result = await inputPromise;
      expect(result).toEqual({ answer: "red", wasFreeform: false });
    });

    it("returns empty response after timeout", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      const mockIO = createMockIO();
      bridge.setIO(mockIO as any);
      await bridge.ensureStarted();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);
      const sessionId = await bridge.createChatSession({ projectId: "proj-1" });

      const configAny = mockClientCreateSession.mock.calls[0]?.[0] as Record<string, unknown>;
      const inputHandler = configAny["onUserInputRequest"] as Function;

      const inputPromise = inputHandler(
        { question: "What?" },
        { sessionId },
      );

      await vi.advanceTimersByTimeAsync(31_000);

      const result = await inputPromise;
      expect(result).toEqual({ answer: "", wasFreeform: false });
    });
  });

  // =========================================================================
  // Elicitation resolution
  // =========================================================================
  describe("resolveElicitation", () => {
    it("resolves a pending elicitation", () => {
      // Manually test the resolve method by reflecting on internal state
      const resolve = vi.fn();
      const timer = setTimeout(() => {}, 30_000);

      // Access private map via casting
      (bridge as any).pendingElicitations.set("e-1", {
        resolve,
        reject: vi.fn(),
        timer,
      });

      bridge.resolveElicitation("e-1", { field: "value" });
      expect(resolve).toHaveBeenCalledWith({ field: "value" });
    });

    it("is a no-op for unknown requestId", () => {
      expect(() => bridge.resolveElicitation("unknown", {})).not.toThrow();
    });
  });

  // =========================================================================
  // SDK event dispatch
  // =========================================================================
  describe("SDK event dispatch", () => {
    let mockSession: ReturnType<typeof createMockSession>;
    let mockIO: ReturnType<typeof createMockIO>;
    let sessionId: string;
    let onHandler: (event: { type: string; data?: Record<string, unknown> }) => void;

    beforeEach(async () => {
      mockIO = createMockIO();
      bridge.setIO(mockIO as any);
      await bridge.ensureStarted();

      mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);
      sessionId = await bridge.createChatSession({ projectId: "proj-1" });
      onHandler = mockSession.on.mock.calls[0]?.[0];
    });

    it("handles assistant.message_delta", () => {
      onHandler({ type: "assistant.message_delta", data: { deltaContent: "chunk" } });

      const emitMock = mockIO.to.mock.results.map((r: any) => r.value?.emit).filter(Boolean);
      let found = false;
      for (const emitFn of emitMock) {
        for (const call of emitFn.mock.calls) {
          if (call[0] === "message-delta" && call[1]?.delta === "chunk") {
            found = true;
          }
        }
      }
      expect(found).toBe(true);
    });

    it("handles assistant.message", () => {
      onHandler({ type: "assistant.message", data: { content: "full message" } });

      const emitMock = mockIO.to.mock.results.map((r: any) => r.value?.emit).filter(Boolean);
      let found = false;
      for (const emitFn of emitMock) {
        for (const call of emitFn.mock.calls) {
          if (call[0] === "message" && call[1]?.content === "full message") {
            found = true;
          }
        }
      }
      expect(found).toBe(true);
    });

    it("handles assistant.turn_start with suppression for first turn", () => {
      // First turn_start should be suppressed (sendMessage sets suppressNextTurnStart)
      // We need to sendMessage first to set the flag
      // The session was just created, suppressNextTurnStart is false by default
      onHandler({ type: "assistant.turn_start", data: {} });

      const emitMock = mockIO.to.mock.results.map((r: any) => r.value?.emit).filter(Boolean);
      let found = false;
      for (const emitFn of emitMock) {
        for (const call of emitFn.mock.calls) {
          if (call[0] === "turn-start") found = true;
        }
      }
      expect(found).toBe(true);
    });

    it("suppresses first turn_start after sendMessage", async () => {
      // Clear all previous IO mock calls
      mockIO.to.mockClear();
      const innerEmit = vi.fn();
      mockIO.to.mockReturnValue({ emit: innerEmit });

      await bridge.sendMessage(sessionId, "test");

      // Now the SDK fires turn_start — should be suppressed
      const allEmitsBefore = innerEmit.mock.calls.length;
      onHandler({ type: "assistant.turn_start", data: {} });
      // The suppressed turn_start should NOT add a new emit
      const turnStartAfter = innerEmit.mock.calls.filter(
        (c: any[]) => c[0] === "turn-start",
      );
      // Only the one from sendMessage itself, not from the SDK event
      expect(turnStartAfter.length).toBeLessThanOrEqual(1);
    });

    it("handles tool.execution_start — assigns roundId on first tool", () => {
      onHandler({ type: "tool.execution_start", data: { toolCallId: "tc-1", toolName: "bash", arguments: { cmd: "ls" } } });

      const emitMock = mockIO.to.mock.results.map((r: any) => r.value?.emit).filter(Boolean);
      let toolStartData: Record<string, unknown> | undefined;
      for (const emitFn of emitMock) {
        for (const call of emitFn.mock.calls) {
          if (call[0] === "tool-start") toolStartData = call[1];
        }
      }
      expect(toolStartData).toBeDefined();
      expect(toolStartData?.["roundId"]).toBeDefined();
      expect(toolStartData?.["toolName"]).toBe("bash");
    });

    it("handles tool.execution_complete — clears roundId when last tool finishes", () => {
      // Start a tool
      onHandler({ type: "tool.execution_start", data: { toolCallId: "tc-1", toolName: "bash" } });
      // Complete it
      onHandler({ type: "tool.execution_complete", data: { toolCallId: "tc-1", toolName: "bash", result: {}, success: true } });

      const managed = bridge.getSession(sessionId);
      expect(managed?.currentRoundId).toBeNull();
      expect(managed?.activeToolCalls.size).toBe(0);
    });

    it("handles session.title_changed", () => {
      onHandler({ type: "session.title_changed", data: { title: "New Title" } });

      const managed = bridge.getSession(sessionId);
      expect(managed?.title).toBe("New Title");
    });

    it("handles session.idle — clears round tracking", () => {
      // First start a tool to set roundId
      onHandler({ type: "tool.execution_start", data: { toolCallId: "tc-1" } });
      expect(bridge.getSession(sessionId)?.currentRoundId).toBeDefined();

      onHandler({ type: "session.idle", data: {} });
      expect(bridge.getSession(sessionId)?.currentRoundId).toBeNull();
      expect(bridge.getSession(sessionId)?.activeToolCalls.size).toBe(0);
    });

    it("handles session.error — triggers crash recovery for system errors", () => {
      onHandler({ type: "session.error", data: { message: "System crash", errorType: "system" } });

      // handleCrash is async; we just verify it was triggered (the error emit)
      const emitMock = mockIO.to.mock.results.map((r: any) => r.value?.emit).filter(Boolean);
      let errorFound = false;
      for (const emitFn of emitMock) {
        for (const call of emitFn.mock.calls) {
          if (call[0] === "error") errorFound = true;
        }
      }
      expect(errorFound).toBe(true);
    });

    it("handles unrecognized event types gracefully", () => {
      expect(() => onHandler({ type: "unknown.event.type", data: {} })).not.toThrow();
    });

    it("handles permission.requested as no-op (handled by callback)", () => {
      expect(() => onHandler({ type: "permission.requested", data: {} })).not.toThrow();
    });

    it("handles subagent.started", () => {
      onHandler({ type: "subagent.started", data: { toolCallId: "tc-1", agentName: "coder", agentDisplayName: "Coder Agent" } });

      const emitMock = mockIO.to.mock.results.map((r: any) => r.value?.emit).filter(Boolean);
      let found = false;
      for (const emitFn of emitMock) {
        for (const call of emitFn.mock.calls) {
          if (call[0] === "subagent-start" && call[1]?.agentName === "coder") found = true;
        }
      }
      expect(found).toBe(true);
    });

    it("handles subagent.completed", () => {
      onHandler({ type: "subagent.completed", data: { toolCallId: "tc-1", agentName: "coder" } });

      const emitMock = mockIO.to.mock.results.map((r: any) => r.value?.emit).filter(Boolean);
      let found = false;
      for (const emitFn of emitMock) {
        for (const call of emitFn.mock.calls) {
          if (call[0] === "subagent-complete") found = true;
        }
      }
      expect(found).toBe(true);
    });

    it("handles subagent.failed", () => {
      onHandler({ type: "subagent.failed", data: { toolCallId: "tc-1", agentName: "coder", error: "out of tokens" } });

      const emitMock = mockIO.to.mock.results.map((r: any) => r.value?.emit).filter(Boolean);
      let found = false;
      for (const emitFn of emitMock) {
        for (const call of emitFn.mock.calls) {
          if (call[0] === "subagent-failed" && call[1]?.error === "out of tokens") found = true;
        }
      }
      expect(found).toBe(true);
    });
  });

  // =========================================================================
  // shutdown
  // =========================================================================
  describe("shutdown", () => {
    it("aborts all sessions, rejects pending, and stops client", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);
      await bridge.createChatSession({ projectId: "proj-1" });

      // Add a pending permission to verify it gets rejected
      const reject = vi.fn();
      const timer = setTimeout(() => {}, 30_000);
      (bridge as any).pendingPermissions.set("p1", { resolve: vi.fn(), reject, timer });

      await bridge.shutdown();

      expect(mockSession.abort).toHaveBeenCalled();
      expect(mockClientStop).toHaveBeenCalled();
      expect(reject).toHaveBeenCalledWith(expect.any(Error));
      expect(bridge.getStatus().status).toBe("not-initialized");
      expect(bridge.getManagedSessionIds()).toHaveLength(0);
    });

    it("falls back to forceStop if stop fails", async () => {
      await bridge.ensureStarted();
      mockClientStop.mockRejectedValue(new Error("stop failed"));

      await bridge.shutdown();
      expect(mockClientForceStop).toHaveBeenCalled();
    });

    it("handles abort errors gracefully", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession();
      mockSession.abort.mockRejectedValue(new Error("abort error"));
      mockClientCreateSession.mockResolvedValue(mockSession);
      await bridge.createChatSession({ projectId: "proj-1" });

      // Should not throw
      await expect(bridge.shutdown()).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // handleCrash
  // =========================================================================
  describe("handleCrash (via session.error)", () => {
    it("recovers after crash", async () => {
      const mockIO = createMockIO();
      bridge.setIO(mockIO as any);
      await bridge.ensureStarted();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);
      await bridge.createChatSession({ projectId: "proj-1" });

      const onHandler = mockSession.on.mock.calls[0]?.[0];

      // Reset start mock — crash recovery will create a new CopilotClient
      mockClientStart.mockResolvedValue(undefined);

      // Switch to fake timers to control crash recovery delays
      vi.useFakeTimers({ shouldAdvanceTime: true });

      // Trigger system error which initiates crash recovery
      onHandler({ type: "session.error", data: { message: "crash", errorType: "system" } });

      // Advance through recovery delay (1s for first attempt)
      await vi.advanceTimersByTimeAsync(2_000);

      // After recovery, state should be ready
      expect(bridge.getStatus().status).toBe("ready");

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // getSession / getManagedSessionIds
  // =========================================================================
  describe("getSession / getManagedSessionIds", () => {
    it("returns session by ID", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession({ sessionId: "s1" });
      mockClientCreateSession.mockResolvedValue(mockSession);
      await bridge.createChatSession({ projectId: "proj-1" });

      expect(bridge.getSession("s1")).toBeDefined();
      expect(bridge.getSession("nonexistent")).toBeUndefined();
    });

    it("returns all managed session IDs", async () => {
      await bridge.ensureStarted();
      mockClientCreateSession
        .mockResolvedValueOnce(createMockSession({ sessionId: "a" }))
        .mockResolvedValueOnce(createMockSession({ sessionId: "b" }));

      await bridge.createChatSession({ projectId: "proj-1" });
      await bridge.createChatSession({ projectId: "proj-1" });

      const ids = bridge.getManagedSessionIds();
      expect(ids).toContain("a");
      expect(ids).toContain("b");
    });
  });

  // =========================================================================
  // Duplicate listener prevention
  // =========================================================================
  describe("duplicate listener prevention", () => {
    it("does not attach event listeners twice for same session", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession({ sessionId: "dup-test" });
      mockClientCreateSession.mockResolvedValue(mockSession);
      await bridge.createChatSession({ projectId: "proj-1" });

      // Resume should re-attach, but attachEventListeners guards with attachedListeners set
      await bridge.resumeSession("dup-test", "proj-1");

      // .on should only be called once
      expect(mockSession.on).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // callExtensionToolEndpoint
  // =========================================================================
  describe("callExtensionToolEndpoint (via registered tool handler)", () => {
    it("calls the extension endpoint and returns JSON", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      vi.mocked(listMounted).mockReturnValue([
        {
          name: "ext1",
          version: "1.0.0",
          status: "mounted",
          manifest: {
            permissions: { llm: true },
            displayName: "Ext1",
            chatTools: [
              { name: "run", description: "Run", endpoint: "POST /run", parameters: {} },
            ],
            chatAgents: [],
          },
        } as any,
      ]);

      // Mock global fetch
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: true }),
      } as any);

      await bridge.createChatSession({ projectId: "proj-1" });

      // Get the registered tool handler
      const extToolsCall = mockSession.registerTools.mock.calls[1]?.[0];
      const toolHandler = extToolsCall[0].handler;

      const result = await toolHandler({ input: "data" });
      expect(result).toEqual({ success: true });
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:42888/api/proj-1/ext1/run",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ input: "data" }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it("returns error object when fetch fails", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      vi.mocked(listMounted).mockReturnValue([
        {
          name: "ext1",
          version: "1.0.0",
          status: "mounted",
          manifest: {
            permissions: { llm: true },
            displayName: "Ext1",
            chatTools: [
              { name: "run", description: "Run", endpoint: "POST /run", parameters: {} },
            ],
            chatAgents: [],
          },
        } as any,
      ]);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));

      await bridge.createChatSession({ projectId: "proj-1" });

      const extToolsCall = mockSession.registerTools.mock.calls[1]?.[0];
      const toolHandler = extToolsCall[0].handler;

      const result = await toolHandler({});
      expect(result).toEqual({ error: "Extension tool failed: network error" });

      fetchSpy.mockRestore();
    });

    it("does not send body for GET requests", async () => {
      await bridge.ensureStarted();
      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      vi.mocked(listMounted).mockReturnValue([
        {
          name: "ext1",
          version: "1.0.0",
          status: "mounted",
          manifest: {
            permissions: { llm: true },
            displayName: "Ext1",
            chatTools: [
              { name: "list", description: "List", endpoint: "GET /items", parameters: {} },
            ],
            chatAgents: [],
          },
        } as any,
      ]);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      } as any);

      await bridge.createChatSession({ projectId: "proj-1" });

      const extToolsCall = mockSession.registerTools.mock.calls[1]?.[0];
      const toolHandler = extToolsCall[0].handler;

      await toolHandler({});
      const fetchOpts = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(fetchOpts.method).toBe("GET");
      expect(fetchOpts.body).toBeUndefined();

      fetchSpy.mockRestore();
    });
  });

  // =========================================================================
  // emitToAllSessions (no IO set)
  // =========================================================================
  describe("emitToSession / emitBridgeStatus without IO", () => {
    it("does not throw when IO is not set", async () => {
      // No setIO call
      await bridge.ensureStarted();
      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);
      const sessionId = await bridge.createChatSession({ projectId: "proj-1" });

      // Trigger events — should not throw even without IO
      const onHandler = mockSession.on.mock.calls[0]?.[0];
      expect(() => onHandler({ type: "assistant.message", data: { content: "hi" } })).not.toThrow();
    });
  });

  // =========================================================================
  // modelSupportsReasoning
  // =========================================================================
  describe("modelSupportsReasoning (via createChatSession)", () => {
    it("includes reasoningEffort when model supports it", async () => {
      await bridge.ensureStarted();
      mockClientListModels.mockResolvedValue([
        { id: "o1", capabilities: { supports: { reasoningEffort: true } } },
      ]);
      await bridge.listModels();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      await bridge.createChatSession({
        projectId: "proj-1",
        model: "o1",
        reasoningEffort: "high",
      });

      const config = mockClientCreateSession.mock.calls[0]?.[0];
      expect(config.reasoningEffort).toBe("high");
    });

    it("omits reasoningEffort when model does not support it", async () => {
      await bridge.ensureStarted();
      mockClientListModels.mockResolvedValue([
        { id: "gpt-4", capabilities: { supports: { reasoningEffort: false } } },
      ]);
      await bridge.listModels();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      await bridge.createChatSession({
        projectId: "proj-1",
        model: "gpt-4",
        reasoningEffort: "high",
      });

      const config = mockClientCreateSession.mock.calls[0]?.[0];
      expect(config.reasoningEffort).toBeUndefined();
    });

    it("omits reasoningEffort when model is not in cache", async () => {
      await bridge.ensureStarted();
      mockClientListModels.mockResolvedValue([]);
      await bridge.listModels();

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      await bridge.createChatSession({
        projectId: "proj-1",
        model: "unknown-model",
        reasoningEffort: "high",
      });

      const config = mockClientCreateSession.mock.calls[0]?.[0];
      expect(config.reasoningEffort).toBeUndefined();
    });
  });

  // =========================================================================
  // assembleSystemPrompt
  // =========================================================================
  describe("assembleSystemPrompt (via createChatSession)", () => {
    it("falls back to default prompt when project not found", async () => {
      await bridge.ensureStarted();

      // Make registry return empty for unknown project
      vi.mocked(getProjectRegistry).mockReturnValue(new Map() as any);
      const { assemble } = await import("./context-recipe-engine.js");
      vi.mocked(assemble).mockResolvedValue({ content: "" } as any);

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      await bridge.createChatSession({ projectId: "unknown-proj" });

      const config = mockClientCreateSession.mock.calls[0]?.[0];
      expect(config.systemMessage.content).toContain("AI assistant");
      expect(config.systemMessage.content).toContain("unknown-proj");
    });

    it("includes extension list in system prompt", async () => {
      await bridge.ensureStarted();

      vi.mocked(getProjectRegistry).mockReturnValue(
        new Map([
          [
            "proj-1",
            {
              name: "Test Project",
              path: "/tmp/project",
              mountedExtensions: [
                { name: "my-ext", version: "2.0.0", status: "mounted" },
              ],
            },
          ],
        ]) as any,
      );

      const mockSession = createMockSession();
      mockClientCreateSession.mockResolvedValue(mockSession);

      await bridge.createChatSession({ projectId: "proj-1" });

      const config = mockClientCreateSession.mock.calls[0]?.[0];
      expect(config.systemMessage.content).toContain("my-ext");
      expect(config.systemMessage.content).toContain("v2.0.0");
    });
  });
});
