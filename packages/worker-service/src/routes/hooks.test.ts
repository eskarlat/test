import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoisted mocks
const mocks = vi.hoisted(() => ({
  enqueueHook: vi.fn(),
  getBatches: vi.fn().mockReturnValue([]),
  aggregateResults: vi.fn().mockReturnValue({}),
  generateHookFile: vi.fn(),
  getProjectRegistry: vi.fn().mockReturnValue(new Map()),
  confirmFromExtension: vi.fn(),
  detectFromPrompt: vi.fn(),
  hookFeatureRegistry: {
    resolve: vi.fn().mockReturnValue(null),
    listAll: vi.fn().mockReturnValue([]),
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../core/hook-feature-registry.js", () => ({
  hookFeatureRegistry: mocks.hookFeatureRegistry,
}));

vi.mock("../core/hook-request-queue.js", () => ({
  enqueueHook: mocks.enqueueHook,
  getBatches: mocks.getBatches,
}));

vi.mock("../core/hook-response-aggregator.js", () => ({
  aggregateResults: mocks.aggregateResults,
}));

vi.mock("../services/hook-file-generator.js", () => ({
  generateHookFile: mocks.generateHookFile,
}));

vi.mock("./projects.js", () => ({
  getRegistry: mocks.getProjectRegistry,
}));

vi.mock("../core/logger.js", () => ({
  logger: mocks.logger,
}));

vi.mock("../core/observations-service.js", () => ({
  confirmFromExtension: mocks.confirmFromExtension,
  detectFromPrompt: mocks.detectFromPrompt,
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./hooks.js";

describe("hooks routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp(router);
  });

  // -------------------------------------------------------------------------
  // POST /api/hooks/enqueue
  // -------------------------------------------------------------------------
  describe("POST /api/hooks/enqueue", () => {
    it("returns 400 when required fields are missing", async () => {
      const res = await request(app, "POST", "/api/hooks/enqueue", {});
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("Missing required fields");
    });

    it("returns 400 when batchId is missing", async () => {
      const res = await request(app, "POST", "/api/hooks/enqueue", {
        feature: "test",
        event: "sessionStart",
        projectId: "p1",
      });
      expect(res.status).toBe(400);
    });

    it("enqueues hook and returns result on success", async () => {
      const hookResult = {
        feature: "context-inject",
        success: true,
        output: { context: "hello" },
        durationMs: 42,
      };
      mocks.enqueueHook.mockResolvedValue(hookResult);
      mocks.aggregateResults.mockReturnValue({ additionalContext: "ctx" });
      mocks.hookFeatureRegistry.resolve.mockReturnValue({
        id: "context-inject",
        event: "sessionStart",
        type: "core",
        timeoutMs: 5000,
      });

      const res = await request(app, "POST", "/api/hooks/enqueue", {
        batchId: "b1",
        feature: "context-inject",
        event: "sessionStart",
        projectId: "p1",
        agent: "copilot",
        input: {},
      });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["ok"]).toBe(true);
      expect(body["result"]).toEqual({ context: "hello" });
      expect(body["aggregated"]).toEqual({ additionalContext: "ctx" });
      expect(mocks.enqueueHook).toHaveBeenCalledOnce();
    });

    it("persists observations from aggregated response", async () => {
      const hookResult = {
        feature: "test-feat",
        success: true,
        output: {},
        durationMs: 10,
      };
      mocks.enqueueHook.mockResolvedValue(hookResult);
      mocks.aggregateResults.mockReturnValue({
        observations: [{ content: "Remember this", category: "preference" }],
      });

      await request(app, "POST", "/api/hooks/enqueue", {
        batchId: "b2",
        feature: "test-feat",
        event: "sessionStart",
        projectId: "p1",
        agent: "copilot",
        input: {},
      });

      expect(mocks.confirmFromExtension).toHaveBeenCalledWith("p1", {
        content: "Remember this",
        source: "extension:test-feat",
        category: "preference",
      });
    });

    it("calls detectFromPrompt for userPromptSubmitted events", async () => {
      const hookResult = {
        feature: "prompt-journal",
        success: true,
        output: {},
        durationMs: 5,
      };
      mocks.enqueueHook.mockResolvedValue(hookResult);
      mocks.aggregateResults.mockReturnValue({});

      await request(app, "POST", "/api/hooks/enqueue", {
        batchId: "b3",
        feature: "prompt-journal",
        event: "userPromptSubmitted",
        projectId: "p1",
        agent: "copilot",
        input: { prompt: "Remember that I prefer tabs" },
      });

      expect(mocks.detectFromPrompt).toHaveBeenCalledWith(
        "p1",
        "Remember that I prefer tabs",
      );
    });

    it("does not call detectFromPrompt for non-userPromptSubmitted events", async () => {
      mocks.enqueueHook.mockResolvedValue({
        feature: "f",
        success: true,
        output: {},
        durationMs: 1,
      });
      mocks.aggregateResults.mockReturnValue({});

      await request(app, "POST", "/api/hooks/enqueue", {
        batchId: "b4",
        feature: "f",
        event: "sessionStart",
        projectId: "p1",
        agent: "copilot",
        input: { prompt: "hello" },
      });

      expect(mocks.detectFromPrompt).not.toHaveBeenCalled();
    });

    it("returns 500 when enqueueHook throws", async () => {
      mocks.enqueueHook.mockRejectedValue(new Error("queue full"));

      const res = await request(app, "POST", "/api/hooks/enqueue", {
        batchId: "b5",
        feature: "test",
        event: "sessionStart",
        projectId: "p1",
        agent: "copilot",
        input: {},
      });

      expect(res.status).toBe(500);
      expect((res.body as Record<string, unknown>)["error"]).toBe("queue full");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/hooks/features
  // -------------------------------------------------------------------------
  describe("GET /api/hooks/features", () => {
    it("returns feature list from registry", async () => {
      const features = [
        { id: "context-inject", event: "sessionStart", type: "core", timeoutMs: 5000 },
      ];
      mocks.hookFeatureRegistry.listAll.mockReturnValue(features);

      const res = await request(app, "GET", "/api/hooks/features");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(features);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/hooks/regenerate
  // -------------------------------------------------------------------------
  describe("POST /api/hooks/regenerate", () => {
    it("returns 400 when projectId is missing", async () => {
      const res = await request(app, "POST", "/api/hooks/regenerate", {});
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("Missing projectId");
    });

    it("returns 404 when project not found", async () => {
      mocks.getProjectRegistry.mockReturnValue(new Map());

      const res = await request(app, "POST", "/api/hooks/regenerate", {
        projectId: "nonexistent",
      });
      expect(res.status).toBe(404);
    });

    it("regenerates hook file on success", async () => {
      const projectMap = new Map([
        ["p1", { id: "p1", name: "Test", path: "/tmp/project" }],
      ]);
      mocks.getProjectRegistry.mockReturnValue(projectMap);
      mocks.hookFeatureRegistry.listAll.mockReturnValue([]);

      const res = await request(app, "POST", "/api/hooks/regenerate", {
        projectId: "p1",
      });

      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["ok"]).toBe(true);
      expect(mocks.generateHookFile).toHaveBeenCalledWith("/tmp/project", []);
    });

    it("returns 500 when generateHookFile throws", async () => {
      const projectMap = new Map([
        ["p1", { id: "p1", name: "Test", path: "/tmp/project" }],
      ]);
      mocks.getProjectRegistry.mockReturnValue(projectMap);
      mocks.generateHookFile.mockImplementation(() => {
        throw new Error("write failed");
      });

      const res = await request(app, "POST", "/api/hooks/regenerate", {
        projectId: "p1",
      });

      expect(res.status).toBe(500);
      expect((res.body as Record<string, unknown>)["error"]).toBe("write failed");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/hooks/activity
  // -------------------------------------------------------------------------
  describe("GET /api/:projectId/hooks/activity", () => {
    it("returns empty array for project with no activity", async () => {
      // Use a unique project ID that has never had activity recorded
      const res = await request(app, "GET", "/api/no-activity-project/hooks/activity");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns activity after enqueue records it", async () => {
      // Enqueue a hook to generate activity
      mocks.enqueueHook.mockResolvedValue({
        feature: "ctx",
        success: true,
        output: {},
        durationMs: 15,
      });
      mocks.aggregateResults.mockReturnValue({});

      await request(app, "POST", "/api/hooks/enqueue", {
        batchId: "b10",
        feature: "ctx",
        event: "sessionStart",
        projectId: "proj-act",
        agent: "copilot",
        input: {},
      });

      const res = await request(app, "GET", "/api/proj-act/hooks/activity");
      expect(res.status).toBe(200);
      const activity = res.body as Array<Record<string, unknown>>;
      expect(activity).toHaveLength(1);
      expect(activity[0]!["feature"]).toBe("ctx");
      expect(activity[0]!["success"]).toBe(true);
      expect(activity[0]!["durationMs"]).toBe(15);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/hooks/batches
  // -------------------------------------------------------------------------
  describe("GET /api/:projectId/hooks/batches", () => {
    it("returns empty array when no batches", async () => {
      mocks.getBatches.mockReturnValue([]);

      const res = await request(app, "GET", "/api/p1/hooks/batches");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns batches filtered by project and summarized", async () => {
      const results = new Map([
        ["ctx", { feature: "ctx", success: true, output: {}, durationMs: 20 }],
      ]);
      mocks.getBatches.mockReturnValue([
        {
          batchId: "b1",
          event: "sessionStart",
          projectId: "p1",
          agent: "copilot",
          startedAt: Date.now(),
          results,
          complete: true,
        },
        {
          batchId: "b2",
          event: "sessionStart",
          projectId: "p2",
          agent: "copilot",
          startedAt: Date.now(),
          results: new Map(),
          complete: false,
        },
      ]);

      const res = await request(app, "GET", "/api/p1/hooks/batches");
      expect(res.status).toBe(200);
      const batches = res.body as Array<Record<string, unknown>>;
      expect(batches).toHaveLength(1);
      expect(batches[0]!["batchId"]).toBe("b1");
      expect(batches[0]!["features"]).toBe(1);
      expect(batches[0]!["complete"]).toBe(true);
      expect(batches[0]!["totalMs"]).toBe(20);
    });

    it("returns null totalMs for incomplete batch", async () => {
      mocks.getBatches.mockReturnValue([
        {
          batchId: "b3",
          event: "sessionStart",
          projectId: "p1",
          agent: "copilot",
          startedAt: Date.now(),
          results: new Map(),
          complete: false,
        },
      ]);

      const res = await request(app, "GET", "/api/p1/hooks/batches");
      const batches = res.body as Array<Record<string, unknown>>;
      expect(batches[0]!["totalMs"]).toBeNull();
    });
  });
});
