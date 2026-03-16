import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all external dependencies before imports
vi.mock("../core/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../core/event-bus.js", () => ({
  eventBus: { publish: vi.fn(), subscribe: vi.fn() },
}));

const mockPrepare = vi.fn().mockReturnValue({
  run: vi.fn(),
  get: vi.fn(),
});
const mockDb = { prepare: mockPrepare };

vi.mock("../core/db-manager.js", () => ({
  dbManager: {
    getConnection: () => mockDb,
  },
}));

vi.mock("../core/server-port.js", () => ({
  getServerPort: () => 42888,
}));

vi.mock("../core/context-monitor.js", () => ({
  trackToolUse: vi.fn(),
  trackPrompt: vi.fn(),
  getUsage: vi.fn().mockReturnValue({ shouldSuggestLearn: false }),
  markSuggested: vi.fn(),
}));

vi.mock("../core/session-memory.js", () => ({
  startSession: vi.fn().mockReturnValue({ sessionId: "test-session-1", additionalContext: "ctx" }),
  checkpoint: vi.fn().mockReturnValue("checkpoint-context"),
  recordHookActivity: vi.fn(),
  buildPromptSummary: vi.fn().mockReturnValue(null),
}));

vi.mock("../core/prompt-journal.js", () => ({
  record: vi.fn(),
}));

vi.mock("../core/tool-governance.js", () => ({
  evaluate: vi.fn().mockReturnValue({ decision: "allow" }),
}));

vi.mock("../core/tool-analytics.js", () => ({
  record: vi.fn(),
}));

vi.mock("../core/error-intelligence.js", () => ({
  record: vi.fn(),
}));

vi.mock("../core/subagent-tracking.js", () => ({
  recordStart: vi.fn().mockReturnValue({ guidelines: "test-guidelines" }),
  recordStop: vi.fn(),
}));

// Mock hookFeatureRegistry
const mockResolve = vi.fn();
const mockListByEvent = vi.fn();

vi.mock("../core/hook-feature-registry.js", () => ({
  hookFeatureRegistry: {
    resolve: (...args: unknown[]) => mockResolve(...args),
    listByEvent: (...args: unknown[]) => mockListByEvent(...args),
    registerCore: vi.fn(),
    registerExtension: vi.fn(),
  },
}));

import { enqueueHook, getBatches, type HookEnqueueRequest } from "./hook-request-queue.js";
import { startSession, checkpoint, buildPromptSummary } from "./session-memory.js";
import { evaluate as evaluateTool } from "./tool-governance.js";
import { getUsage, markSuggested } from "./context-monitor.js";
import { recordStart as recordSubagentStart } from "./subagent-tracking.js";

function makeRequest(overrides: Partial<HookEnqueueRequest> = {}): HookEnqueueRequest {
  return {
    batchId: `batch-${Date.now()}-${crypto.randomUUID()}`,
    feature: "context-inject",
    event: "sessionStart",
    projectId: "proj-1",
    agent: "claude-code",
    input: {},
    ...overrides,
  };
}

function setupDefaultMocks(): void {
  // Reset the dependency mocks to their default return values
  vi.mocked(startSession).mockReturnValue({ sessionId: "test-session-1", additionalContext: "ctx" } as never);
  vi.mocked(checkpoint).mockReturnValue("checkpoint-context" as never);
  vi.mocked(buildPromptSummary).mockReturnValue(null as never);
  vi.mocked(evaluateTool).mockReturnValue({ decision: "allow" } as never);
  vi.mocked(getUsage).mockReturnValue({ shouldSuggestLearn: false } as never);
  vi.mocked(recordSubagentStart).mockReturnValue({ guidelines: "test-guidelines" } as never);

  mockPrepare.mockReturnValue({ run: vi.fn(), get: vi.fn() });

  mockResolve.mockReturnValue({ id: "context-inject", event: "sessionStart", type: "core", timeoutMs: 5000 });
  mockListByEvent.mockReturnValue([{ id: "context-inject", event: "sessionStart", type: "core", timeoutMs: 5000 }]);
}

describe("hook-request-queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("enqueueHook", () => {
    it("creates a batch and returns a result for a core feature", async () => {
      const req = makeRequest();
      const result = await enqueueHook(req);

      expect(result.feature).toBe("context-inject");
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ additionalContext: "ctx" });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("reuses existing batch when same batchId is enqueued again", async () => {
      const batchId = `reuse-batch-${Date.now()}`;

      const req1 = makeRequest({ batchId, feature: "context-inject" });
      const result1 = await enqueueHook(req1);
      expect(result1.success).toBe(true);

      // Second request with same batchId should find cached result
      const req2 = makeRequest({ batchId, feature: "context-inject" });
      const result2 = await enqueueHook(req2);
      expect(result2.success).toBe(true);
      expect(result2.feature).toBe("context-inject");
    });

    it("returns cached result if feature already resolved in batch", async () => {
      const batchId = `cached-${Date.now()}`;
      const req = makeRequest({ batchId });

      const r1 = await enqueueHook(req);
      expect(r1.success).toBe(true);

      // Second call returns cached
      const r2 = await enqueueHook(req);
      expect(r2.success).toBe(true);
      expect(r2.feature).toBe("context-inject");
    });

    it("uses default timeout when feature is not in registry (resolve returns null)", async () => {
      // When resolve returns null for the enqueued feature, the default timeout of 5000ms is used.
      // The feature IS in listByEvent so it gets processed by processBatch.
      // Since resolve returns null inside executeFeature, the result is an error.
      mockResolve.mockReturnValue(null);
      mockListByEvent.mockReturnValue([{ id: "unknown-feature", event: "sessionStart", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({ feature: "unknown-feature" });
      const result = await enqueueHook(req);

      expect(result.feature).toBe("unknown-feature");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not registered");
    });

    it("uses custom timeout from feature definition", async () => {
      mockResolve.mockReturnValue({ id: "context-inject", event: "sessionStart", type: "core", timeoutMs: 200 });
      mockListByEvent.mockReturnValue([{ id: "context-inject", event: "sessionStart", type: "core", timeoutMs: 200 }]);

      const req = makeRequest();
      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
    });
  });

  describe("getBatches", () => {
    it("returns all active batches", async () => {
      const batchId = `gb-${Date.now()}`;
      await enqueueHook(makeRequest({ batchId }));

      const all = getBatches();
      const found = all.find((b) => b.batchId === batchId);
      expect(found).toBeDefined();
      expect(found!.event).toBe("sessionStart");
      expect(found!.projectId).toBe("proj-1");
      expect(found!.agent).toBe("claude-code");
      expect(found!.complete).toBe(true);
    });
  });

  describe("stale batch cleanup", () => {
    it("removes batches older than BATCH_TTL_MS (60s)", async () => {
      // Create a batch with real timers first
      const oldBatchId = `stale-${Date.now()}`;
      await enqueueHook(makeRequest({ batchId: oldBatchId }));
      expect(getBatches().some((b) => b.batchId === oldBatchId)).toBe(true);

      // Now manipulate the batch's startedAt to simulate age
      const batch = getBatches().find((b) => b.batchId === oldBatchId);
      if (batch) {
        // Set startedAt to 61 seconds ago
        batch.startedAt = Date.now() - 61_000;
      }

      // Enqueue a new request to trigger cleanup
      const newBatchId = `fresh-${Date.now()}`;
      await enqueueHook(makeRequest({ batchId: newBatchId }));

      // Old batch should be cleaned up
      expect(getBatches().some((b) => b.batchId === oldBatchId)).toBe(false);
      expect(getBatches().some((b) => b.batchId === newBatchId)).toBe(true);
    });
  });

  describe("core feature execution", () => {
    it("handles context-inject (sessionStart)", async () => {
      const req = makeRequest({ event: "sessionStart", feature: "context-inject", input: { source: "cli" } });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ additionalContext: "ctx" });
      expect(startSession).toHaveBeenCalled();
    });

    it("handles session-capture (sessionEnd)", async () => {
      mockResolve.mockReturnValue({ id: "session-capture", event: "sessionEnd", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "session-capture", event: "sessionEnd", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `se-${Date.now()}`,
        event: "sessionEnd",
        feature: "session-capture",
        input: { summary: "user wrote tests" },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
    });

    it("handles prompt-journal (userPromptSubmitted)", async () => {
      mockResolve.mockReturnValue({ id: "prompt-journal", event: "userPromptSubmitted", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "prompt-journal", event: "userPromptSubmitted", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `pj-${Date.now()}`,
        event: "userPromptSubmitted",
        feature: "prompt-journal",
        input: { prompt: "Write me a test" },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
    });

    it("handles tool-governance (preToolUse) allowing tool", async () => {
      mockResolve.mockReturnValue({ id: "tool-governance", event: "preToolUse", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "tool-governance", event: "preToolUse", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `tg-allow-${Date.now()}`,
        event: "preToolUse",
        feature: "tool-governance",
        input: { tool_name: "read_file", tool_input: { path: "/test" } },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({});
    });

    it("handles tool-governance (preToolUse) denying tool", async () => {
      vi.mocked(evaluateTool).mockReturnValue({ decision: "deny", reason: "dangerous tool" } as never);
      mockResolve.mockReturnValue({ id: "tool-governance", event: "preToolUse", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "tool-governance", event: "preToolUse", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `tg-deny-${Date.now()}`,
        event: "preToolUse",
        feature: "tool-governance",
        input: { tool_name: "exec", tool_input: { cmd: "rm -rf /" } },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({
        permissionDecision: "deny",
        permissionDecisionReason: "dangerous tool",
      });
    });

    it("handles tool-analytics (postToolUse)", async () => {
      mockResolve.mockReturnValue({ id: "tool-analytics", event: "postToolUse", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "tool-analytics", event: "postToolUse", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `ta-${Date.now()}`,
        event: "postToolUse",
        feature: "tool-analytics",
        input: { tool_name: "read_file", tool_input: {}, tool_response: { content: "ok" }, durationMs: 42, success: true },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
    });

    it("handles error-intelligence (errorOccurred) with flat error format", async () => {
      mockResolve.mockReturnValue({ id: "error-intelligence", event: "errorOccurred", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "error-intelligence", event: "errorOccurred", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `ei-flat-${Date.now()}`,
        event: "errorOccurred",
        feature: "error-intelligence",
        input: { error_message: "Something broke", error_type: "TypeError", stack: "at foo:1" },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
    });

    it("handles error-intelligence (errorOccurred) with nested error format", async () => {
      mockResolve.mockReturnValue({ id: "error-intelligence", event: "errorOccurred", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "error-intelligence", event: "errorOccurred", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `ei-nested-${Date.now()}`,
        event: "errorOccurred",
        feature: "error-intelligence",
        input: { error: { message: "Nested error", name: "RangeError", stack: "at bar:2" } },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
    });

    it("handles session-checkpoint (preCompact)", async () => {
      mockResolve.mockReturnValue({ id: "session-checkpoint", event: "preCompact", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "session-checkpoint", event: "preCompact", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `sc-${Date.now()}`,
        event: "preCompact",
        feature: "session-checkpoint",
        input: { custom_instructions: "remember this" },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
      expect(result.output).toHaveProperty("continue", true);
      expect(result.output).toHaveProperty("systemMessage");
    });

    it("handles subagent-track (subagentStart)", async () => {
      mockResolve.mockReturnValue({ id: "subagent-track", event: "subagentStart", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "subagent-track", event: "subagentStart", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `sat-${Date.now()}`,
        event: "subagentStart",
        feature: "subagent-track",
        input: { agent_type: "researcher", parent_agent_id: "parent-1" },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ guidelines: "test-guidelines" });
    });

    it("handles subagent-complete (subagentStop)", async () => {
      mockResolve.mockReturnValue({ id: "subagent-complete", event: "subagentStop", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "subagent-complete", event: "subagentStop", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `sac-${Date.now()}`,
        event: "subagentStop",
        feature: "subagent-complete",
        input: { agent_type: "researcher", start_event_id: "evt-1" },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
    });

    it("returns empty object for unknown core feature (default switch branch)", async () => {
      const featureId = "some-unknown-core";
      mockResolve.mockReturnValue({ id: featureId, event: "sessionStart", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: featureId, event: "sessionStart", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `unk-${Date.now()}`,
        feature: featureId,
      });
      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({});
    });

    it("catches and reports errors from core feature handlers", async () => {
      vi.mocked(startSession).mockImplementation(() => {
        throw new Error("session DB locked");
      });

      const req = makeRequest({ batchId: `err-${Date.now()}` });
      const result = await enqueueHook(req);
      expect(result.success).toBe(false);
      expect(result.error).toContain("session DB locked");
    });
  });

  describe("extension feature execution", () => {
    it("calls extension endpoint via fetch and handles success", async () => {
      const featureId = "my-ext:sessionStart";
      mockResolve.mockReturnValue({ id: featureId, event: "sessionStart", type: "extension", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: featureId, event: "sessionStart", type: "extension", timeoutMs: 5000 }]);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: "extension-result" }),
      }));

      const req = makeRequest({
        batchId: `ext-ok-${Date.now()}`,
        feature: featureId,
        event: "sessionStart",
      });
      const result = await enqueueHook(req);

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ data: "extension-result" });
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/proj-1/my-ext/__hooks/sessionStart"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("handles extension fetch failure", async () => {
      const featureId = "broken-ext:sessionStart";
      mockResolve.mockReturnValue({ id: featureId, event: "sessionStart", type: "extension", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: featureId, event: "sessionStart", type: "extension", timeoutMs: 5000 }]);

      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

      const req = makeRequest({
        batchId: `ext-fail-${Date.now()}`,
        feature: featureId,
        event: "sessionStart",
      });
      const result = await enqueueHook(req);

      expect(result.success).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
    });

    it("handles extension returning non-ok response", async () => {
      const featureId = "bad-ext:sessionStart";
      mockResolve.mockReturnValue({ id: featureId, event: "sessionStart", type: "extension", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: featureId, event: "sessionStart", type: "extension", timeoutMs: 5000 }]);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

      const req = makeRequest({
        batchId: `ext-500-${Date.now()}`,
        feature: featureId,
        event: "sessionStart",
      });
      const result = await enqueueHook(req);

      expect(result.success).toBe(false);
      expect(result.output).toBeNull();
    });

    it("returns error for invalid extension feature ID (no colon)", async () => {
      const featureId = "noColonHere";
      mockResolve.mockReturnValue({ id: featureId, event: "sessionStart", type: "extension", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: featureId, event: "sessionStart", type: "extension", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `ext-bad-id-${Date.now()}`,
        feature: featureId,
        event: "sessionStart",
      });
      const result = await enqueueHook(req);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid extension feature ID");
    });
  });

  describe("unregistered feature", () => {
    it("returns error when feature is not in registry", async () => {
      // The feature is in listByEvent so it gets processed, but resolve returns null
      mockResolve.mockReturnValue(null);
      mockListByEvent.mockReturnValue([{ id: "totally-unknown", event: "sessionStart", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `unreg-${Date.now()}`,
        feature: "totally-unknown",
      });
      const result = await enqueueHook(req);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not registered");
    });
  });

  describe("concurrent batch features", () => {
    it("processes multiple features in same batch concurrently", async () => {
      const batchId = `multi-${Date.now()}`;
      const featureA = "context-inject";
      const featureB = "prompt-journal";

      mockResolve.mockImplementation((id: string) => {
        if (id === featureA) return { id: featureA, event: "sessionStart", type: "core", timeoutMs: 5000 };
        if (id === featureB) return { id: featureB, event: "sessionStart", type: "core", timeoutMs: 5000 };
        return null;
      });
      mockListByEvent.mockReturnValue([
        { id: featureA, event: "sessionStart", type: "core", timeoutMs: 5000 },
        { id: featureB, event: "sessionStart", type: "core", timeoutMs: 5000 },
      ]);

      // First enqueue creates batch and kicks off processing of all features
      const r1 = await enqueueHook(makeRequest({ batchId, feature: featureA }));
      expect(r1.success).toBe(true);

      // Second enqueue for different feature in same batch should find cached result
      const r2 = await enqueueHook(makeRequest({ batchId, feature: featureB }));
      expect(r2.success).toBe(true);
      expect(r2.feature).toBe(featureB);
    });
  });

  describe("waitForResult timeout", () => {
    it("returns timeout error when feature result never appears", async () => {
      const batchId = `timeout-${Date.now()}`;
      const featureId = "my-feature";

      // Feature is registered with a short timeout but is NOT in listByEvent,
      // so processBatch never processes it, causing waitForResult to timeout.
      mockResolve.mockReturnValue({ id: featureId, event: "sessionStart", type: "core", timeoutMs: 50 });
      mockListByEvent.mockReturnValue([
        { id: "other-feature", event: "sessionStart", type: "core", timeoutMs: 5000 },
      ]);

      const req = makeRequest({ batchId, feature: featureId });
      const result = await enqueueHook(req);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Timeout");
      expect(result.durationMs).toBe(50);
    });
  });

  describe("learn tip suggestion", () => {
    it("includes learn tip when usage threshold is reached for prompt-journal", async () => {
      vi.mocked(getUsage).mockReturnValue({ shouldSuggestLearn: true } as never);

      mockResolve.mockReturnValue({ id: "prompt-journal", event: "userPromptSubmitted", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "prompt-journal", event: "userPromptSubmitted", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `learn-${Date.now()}`,
        event: "userPromptSubmitted",
        feature: "prompt-journal",
        input: { prompt: "another prompt" },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
      expect(result.output).toHaveProperty("additionalContext");
      expect((result.output as Record<string, string>).additionalContext).toContain("/learn");
      expect(markSuggested).toHaveBeenCalled();
    });

    it("includes learn tip when usage threshold is reached for tool-analytics", async () => {
      vi.mocked(getUsage).mockReturnValue({ shouldSuggestLearn: true } as never);

      mockResolve.mockReturnValue({ id: "tool-analytics", event: "postToolUse", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "tool-analytics", event: "postToolUse", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `learn-ta-${Date.now()}`,
        event: "postToolUse",
        feature: "tool-analytics",
        input: { tool_name: "read_file", tool_input: {}, tool_response: {} },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
      expect(result.output).toHaveProperty("additionalContext");
      expect(markSuggested).toHaveBeenCalled();
    });
  });

  describe("camelCase fallback for agent inputs", () => {
    it("tool-governance accepts camelCase toolName", async () => {
      mockResolve.mockReturnValue({ id: "tool-governance", event: "preToolUse", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "tool-governance", event: "preToolUse", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `cc-tg-${Date.now()}`,
        event: "preToolUse",
        feature: "tool-governance",
        input: { toolName: "write_file", toolInput: { path: "/x" } },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
      expect(evaluateTool).toHaveBeenCalledWith(
        "proj-1",
        expect.anything(),
        "write_file",
        expect.any(String),
      );
    });

    it("tool-analytics accepts camelCase fields", async () => {
      mockResolve.mockReturnValue({ id: "tool-analytics", event: "postToolUse", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "tool-analytics", event: "postToolUse", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `cc-ta-${Date.now()}`,
        event: "postToolUse",
        feature: "tool-analytics",
        input: { toolName: "read", toolInput: {}, toolOutput: { ok: true } },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
    });

    it("subagent-track accepts camelCase agentType and parentAgentId", async () => {
      mockResolve.mockReturnValue({ id: "subagent-track", event: "subagentStart", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "subagent-track", event: "subagentStart", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `cc-sa-${Date.now()}`,
        event: "subagentStart",
        feature: "subagent-track",
        input: { agentType: "coder", parentAgentId: "p-1" },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
    });

    it("subagent-complete accepts camelCase fields", async () => {
      mockResolve.mockReturnValue({ id: "subagent-complete", event: "subagentStop", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "subagent-complete", event: "subagentStop", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `cc-sac-${Date.now()}`,
        event: "subagentStop",
        feature: "subagent-complete",
        input: { agentType: "coder", startEventId: "evt-2" },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
    });
  });

  describe("session resolution from DB", () => {
    it("resolves session from database when not in memory for session-capture", async () => {
      mockPrepare.mockReturnValue({
        run: vi.fn(),
        get: vi.fn().mockReturnValue({ id: "db-session-42" }),
      });
      mockResolve.mockReturnValue({ id: "session-capture", event: "sessionEnd", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "session-capture", event: "sessionEnd", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `dbses-${Date.now()}`,
        event: "sessionEnd",
        feature: "session-capture",
        // Use a different projectId/agent combo to ensure no cached session
        projectId: "proj-db-test",
        agent: "copilot",
        input: { summary: "test" },
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
    });

    it("handles DB errors gracefully during session resolution", async () => {
      mockPrepare.mockImplementation(() => {
        throw new Error("DB corrupt");
      });
      mockResolve.mockReturnValue({ id: "session-capture", event: "sessionEnd", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "session-capture", event: "sessionEnd", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `dberr-${Date.now()}`,
        event: "sessionEnd",
        feature: "session-capture",
        projectId: "proj-db-err",
        agent: "copilot-err",
        input: {},
      });

      // Should not throw -- DB errors in resolveSessionId are non-fatal
      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
    });
  });

  describe("session-capture with buildPromptSummary", () => {
    it("uses buildPromptSummary when no explicit summary provided", async () => {
      vi.mocked(buildPromptSummary).mockReturnValue("auto-generated summary" as never);
      mockPrepare.mockReturnValue({
        run: vi.fn(),
        get: vi.fn().mockReturnValue({ id: "sess-auto" }),
      });
      mockResolve.mockReturnValue({ id: "session-capture", event: "sessionEnd", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "session-capture", event: "sessionEnd", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `auto-sum-${Date.now()}`,
        event: "sessionEnd",
        feature: "session-capture",
        projectId: "proj-auto",
        agent: "agent-auto",
        input: {}, // no summary field
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
      expect(buildPromptSummary).toHaveBeenCalled();
    });
  });

  describe("session-checkpoint with summary update", () => {
    it("updates session summary on checkpoint when available", async () => {
      vi.mocked(buildPromptSummary).mockReturnValue("checkpoint summary" as never);
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({
        run: mockRun,
        get: vi.fn().mockReturnValue({ id: "sess-cp" }),
      });
      mockResolve.mockReturnValue({ id: "session-checkpoint", event: "preCompact", type: "core", timeoutMs: 5000 });
      mockListByEvent.mockReturnValue([{ id: "session-checkpoint", event: "preCompact", type: "core", timeoutMs: 5000 }]);

      const req = makeRequest({
        batchId: `cp-sum-${Date.now()}`,
        event: "preCompact",
        feature: "session-checkpoint",
        projectId: "proj-cp",
        agent: "agent-cp",
        input: {},
      });

      const result = await enqueueHook(req);
      expect(result.success).toBe(true);
      expect(buildPromptSummary).toHaveBeenCalled();
    });
  });

  describe("batch completeness", () => {
    it("marks batch as complete after processing finishes", async () => {
      const batchId = `complete-${Date.now()}`;
      await enqueueHook(makeRequest({ batchId }));

      const batch = getBatches().find((b) => b.batchId === batchId);
      expect(batch).toBeDefined();
      expect(batch!.complete).toBe(true);
      expect(batch!.results.size).toBeGreaterThan(0);
    });

    it("marks batch as complete even when all features fail", async () => {
      mockResolve.mockReturnValue(null);
      mockListByEvent.mockReturnValue([{ id: "bad-feature", event: "sessionStart", type: "core", timeoutMs: 5000 }]);

      const batchId = `fail-all-${Date.now()}`;
      // The enqueued feature is "context-inject" which isn't in listByEvent,
      // so it will timeout. But the batch itself should complete.
      // Use a short timeout by making resolve return short timeout for "context-inject"
      mockResolve.mockImplementation((id: string) => {
        if (id === "context-inject") return { id, event: "sessionStart", type: "core", timeoutMs: 50 };
        return null;
      });

      await enqueueHook(makeRequest({ batchId }));

      const batch = getBatches().find((b) => b.batchId === batchId);
      expect(batch).toBeDefined();
      expect(batch!.complete).toBe(true);
    });
  });
});
