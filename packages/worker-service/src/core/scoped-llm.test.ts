import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./logger.js", () => ({
  logger: mocks.logger,
}));

import { createScopedLLM } from "./scoped-llm.js";
import type { CopilotBridge } from "./copilot-bridge.js";

// ---------------------------------------------------------------------------
// Mock bridge factory
// ---------------------------------------------------------------------------

function createMockBridge(overrides?: Partial<CopilotBridge>): CopilotBridge {
  return {
    listModels: vi.fn().mockResolvedValue([
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet",
        supportsVision: true,
        supportsReasoning: false,
        maxContextTokens: 200_000,
      },
      {
        id: "gpt-4o",
        // name intentionally missing to test fallback
      },
    ]),
    createChatSession: vi.fn().mockResolvedValue("session-1"),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getSessionMessages: vi.fn().mockResolvedValue([
      {
        type: "assistant.message",
        data: { content: "Hello from assistant", model: "claude-sonnet-4-20250514" },
      },
    ]),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as CopilotBridge;
}

describe("createScopedLLM", () => {
  let bridge: CopilotBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    bridge = createMockBridge();
  });

  // -------------------------------------------------------------------------
  // listModels
  // -------------------------------------------------------------------------
  describe("listModels", () => {
    it("returns mapped model info from bridge", async () => {
      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const models = await llm.listModels();

      expect(models).toHaveLength(2);
      expect(models[0]).toEqual({
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet",
        supportsVision: true,
        supportsReasoning: false,
        maxContextTokens: 200_000,
      });
    });

    it("uses id as fallback when name is missing", async () => {
      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const models = await llm.listModels();

      expect(models[1]!.name).toBe("gpt-4o");
    });

    it("defaults supportsVision and supportsReasoning to false", async () => {
      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const models = await llm.listModels();

      expect(models[1]!.supportsVision).toBe(false);
      expect(models[1]!.supportsReasoning).toBe(false);
    });

    it("defaults maxContextTokens to 128000", async () => {
      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const models = await llm.listModels();

      expect(models[1]!.maxContextTokens).toBe(128_000);
    });

    it("wraps errors with extension context", async () => {
      bridge = createMockBridge({
        listModels: vi.fn().mockRejectedValue(new Error("API unavailable")),
      });
      const llm = createScopedLLM("test-ext", "proj-1", bridge);

      await expect(llm.listModels()).rejects.toThrow("LLM listModels failed: API unavailable");
    });

    it("includes supportedReasoningEfforts when present", async () => {
      bridge = createMockBridge({
        listModels: vi.fn().mockResolvedValue([
          {
            id: "o1",
            name: "O1",
            supportsReasoning: true,
            supportedReasoningEfforts: ["low", "medium", "high"],
          },
        ]),
      });
      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const models = await llm.listModels();

      expect(models[0]!.supportedReasoningEfforts).toEqual(["low", "medium", "high"]);
    });
  });

  // -------------------------------------------------------------------------
  // complete
  // -------------------------------------------------------------------------
  describe("complete", () => {
    it("creates session, sends message, collects response, deletes session", async () => {
      const llm = createScopedLLM("test-ext", "proj-1", bridge);

      const response = await llm.complete({ prompt: "Hello" });

      expect(response.content).toBe("Hello from assistant");
      expect(response.model).toBe("claude-sonnet-4-20250514");
      expect(response.usage).toEqual({ promptTokens: 0, completionTokens: 0 });

      expect(bridge.createChatSession).toHaveBeenCalledWith({ projectId: "proj-1" });
      expect(bridge.sendMessage).toHaveBeenCalledWith("session-1", "Hello", undefined);
      expect(bridge.deleteSession).toHaveBeenCalledWith("session-1");
    });

    it("passes model and reasoningEffort to session", async () => {
      const llm = createScopedLLM("test-ext", "proj-1", bridge);

      await llm.complete({
        prompt: "Think carefully",
        model: "o1",
        reasoningEffort: "high",
      });

      expect(bridge.createChatSession).toHaveBeenCalledWith({
        projectId: "proj-1",
        model: "o1",
        reasoningEffort: "high",
      });
    });

    it("maps attachments correctly", async () => {
      const llm = createScopedLLM("test-ext", "proj-1", bridge);

      await llm.complete({
        prompt: "Analyze this",
        attachments: [
          { type: "file", path: "/tmp/test.ts", displayName: "test.ts" },
          { type: "directory", path: "/tmp/src" },
        ],
      });

      expect(bridge.sendMessage).toHaveBeenCalledWith(
        "session-1",
        "Analyze this",
        [
          { type: "file", path: "/tmp/test.ts", displayName: "test.ts" },
          { type: "directory", path: "/tmp/src" },
        ],
      );
    });

    it("includes reasoning when present in events", async () => {
      bridge = createMockBridge({
        getSessionMessages: vi.fn().mockResolvedValue([
          { type: "assistant.message", data: { content: "The answer is 42", model: "o1" } },
          { type: "assistant.reasoning", data: { content: "Let me think..." } },
        ]),
      });

      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const response = await llm.complete({ prompt: "What is the answer?" });

      expect(response.content).toBe("The answer is 42");
      expect(response.reasoning).toBe("Let me think...");
    });

    it("wraps errors", async () => {
      bridge = createMockBridge({
        createChatSession: vi.fn().mockRejectedValue(new Error("session limit")),
      });

      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      await expect(llm.complete({ prompt: "Hi" })).rejects.toThrow(
        "LLM complete failed: session limit",
      );
    });
  });

  // -------------------------------------------------------------------------
  // stream
  // -------------------------------------------------------------------------
  describe("stream", () => {
    it("creates session, streams, calls onComplete, deletes session", async () => {
      const onComplete = vi.fn();
      const onDelta = vi.fn();

      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      await llm.stream({ prompt: "Stream me" }, { onDelta, onComplete });

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Hello from assistant",
          model: "claude-sonnet-4-20250514",
        }),
      );
      expect(bridge.deleteSession).toHaveBeenCalledWith("session-1");
    });

    it("calls onError handler instead of throwing when provided", async () => {
      bridge = createMockBridge({
        createChatSession: vi.fn().mockRejectedValue(new Error("stream fail")),
      });

      const onError = vi.fn();
      const llm = createScopedLLM("test-ext", "proj-1", bridge);

      await llm.stream({ prompt: "Hi" }, { onError });

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        message: "LLM stream failed: stream fail",
      }));
    });

    it("throws when onError is not provided", async () => {
      bridge = createMockBridge({
        createChatSession: vi.fn().mockRejectedValue(new Error("stream fail")),
      });

      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      await expect(llm.stream({ prompt: "Hi" }, {})).rejects.toThrow(
        "LLM stream failed: stream fail",
      );
    });
  });

  // -------------------------------------------------------------------------
  // createSession
  // -------------------------------------------------------------------------
  describe("createSession", () => {
    it("creates a session proxy with sessionId", async () => {
      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const session = await llm.createSession({ model: "claude-sonnet-4-20250514" });

      expect(session.sessionId).toBe("session-1");
      expect(bridge.createChatSession).toHaveBeenCalledWith({
        projectId: "proj-1",
        model: "claude-sonnet-4-20250514",
      });
    });

    it("session.send collects response and tracks messages", async () => {
      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const session = await llm.createSession();

      const response = await session.send("Hello");
      expect(response.content).toBe("Hello from assistant");

      const messages = await session.getMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0]!.role).toBe("user");
      expect(messages[0]!.content).toBe("Hello");
      expect(messages[1]!.role).toBe("assistant");
      expect(messages[1]!.content).toBe("Hello from assistant");
    });

    it("session.send wraps errors", async () => {
      bridge = createMockBridge({
        sendMessage: vi.fn().mockRejectedValue(new Error("send fail")),
      });

      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const session = await llm.createSession();

      await expect(session.send("Hi")).rejects.toThrow("LLM session.send failed: send fail");
    });

    it("session.stream calls handlers and tracks messages", async () => {
      const onDelta = vi.fn();
      const onReasoning = vi.fn();
      const onComplete = vi.fn();

      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const session = await llm.createSession();

      await session.stream("Tell me", {
        onDelta,
        onReasoning,
        onComplete,
      });

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Hello from assistant" }),
      );

      const messages = await session.getMessages();
      expect(messages).toHaveLength(2);
    });

    it("session.stream calls onError when provided on failure", async () => {
      bridge = createMockBridge({
        sendMessage: vi.fn().mockRejectedValue(new Error("stream err")),
      });

      const onError = vi.fn();
      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const session = await llm.createSession();

      await session.stream("Hi", { onError });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "LLM session.stream failed: stream err" }),
      );
    });

    it("session.disconnect calls bridge.deleteSession", async () => {
      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const session = await llm.createSession();

      await session.disconnect();
      // deleteSession called twice: once during createSession test flow is not applicable here
      // It's called for disconnect specifically
      expect(bridge.deleteSession).toHaveBeenCalledWith("session-1");
    });

    it("session.disconnect swallows errors and logs warning", async () => {
      bridge = createMockBridge({
        deleteSession: vi.fn().mockRejectedValue(new Error("delete fail")),
      });

      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const session = await llm.createSession();

      // Should not throw
      await session.disconnect();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        "ext:test-ext",
        expect.stringContaining("disconnect error"),
      );
    });

    it("createSession wraps errors", async () => {
      bridge = createMockBridge({
        createChatSession: vi.fn().mockRejectedValue(new Error("no session")),
      });

      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      await expect(llm.createSession()).rejects.toThrow(
        "LLM createSession failed: no session",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Rate limiting (log-only)
  // -------------------------------------------------------------------------
  describe("rate tracking", () => {
    it("logs warning at threshold (60 requests)", async () => {
      // Use a unique extension name to avoid cross-test pollution
      const extName = "rate-test-ext-" + Math.random().toString(36).slice(2);
      const llm = createScopedLLM(extName, "proj-1", bridge);

      // Make 60 requests to trigger the warning
      for (let i = 0; i < 60; i++) {
        await llm.listModels();
      }

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        `ext:${extName}`,
        expect.stringContaining("rate warning"),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe("edge cases", () => {
    it("handles empty events array from getSessionMessages", async () => {
      bridge = createMockBridge({
        getSessionMessages: vi.fn().mockResolvedValue([]),
      });

      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const response = await llm.complete({ prompt: "Empty" });

      expect(response.content).toBe("");
      expect(response.model).toBe("default");
    });

    it("handles null/undefined events in array", async () => {
      bridge = createMockBridge({
        getSessionMessages: vi.fn().mockResolvedValue([null, undefined]),
      });

      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      const response = await llm.complete({ prompt: "Null events" });

      expect(response.content).toBe("");
    });

    it("complete with no attachments passes undefined", async () => {
      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      await llm.complete({ prompt: "No attachments" });

      expect(bridge.sendMessage).toHaveBeenCalledWith(
        "session-1",
        "No attachments",
        undefined,
      );
    });

    it("complete with empty attachments array passes undefined", async () => {
      const llm = createScopedLLM("test-ext", "proj-1", bridge);
      await llm.complete({ prompt: "Empty attachments", attachments: [] });

      expect(bridge.sendMessage).toHaveBeenCalledWith(
        "session-1",
        "Empty attachments",
        undefined,
      );
    });
  });
});
