import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import type {
  AutomationEngine,
  Automation,
  AutomationRun,
} from "../core/automation-engine.js";
import type { CopilotBridge } from "../core/copilot-bridge.js";

// Mock logger
vi.mock("../core/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock node-cron
vi.mock("node-cron", () => ({
  default: {
    validate: (expr: string) => expr !== "invalid-cron",
  },
}));

import automationRouter, {
  setAutomationEngine,
  setCopilotBridge,
  setDb,
} from "./automations.js";
import { request } from "../test-helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use(automationRouter);
  return app;
}

function sampleAutomation(overrides?: Partial<Automation>): Automation {
  return {
    id: "auto-1",
    projectId: "proj-1",
    name: "Test Automation",
    description: "A test automation",
    enabled: true,
    schedule: { type: "manual" },
    chain: [
      {
        id: "step-1",
        name: "analyze",
        prompt: "Analyze the code",
        model: "claude-sonnet-4-20250514",
        tools: { builtIn: true, extensions: "all", mcp: "all" },
        onError: "stop" as const,
      },
    ],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function sampleRun(overrides?: Partial<AutomationRun>): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    projectId: "proj-1",
    status: "completed",
    triggerType: "manual",
    stepCount: 1,
    stepsCompleted: 1,
    totalInputTokens: 10,
    totalOutputTokens: 20,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createMockEngine(): AutomationEngine {
  return {
    createAutomation: vi.fn().mockReturnValue(sampleAutomation()),
    getAutomation: vi.fn().mockReturnValue(sampleAutomation()),
    updateAutomation: vi.fn().mockReturnValue(sampleAutomation()),
    deleteAutomation: vi.fn(),
    listAutomations: vi.fn().mockReturnValue([sampleAutomation()]),
    toggleAutomation: vi.fn(),
    triggerRun: vi.fn().mockReturnValue("run-1"),
    listRuns: vi.fn().mockReturnValue([sampleRun()]),
    getRunDetails: vi.fn().mockReturnValue(sampleRun()),
    cancelRun: vi.fn(),
    runLogCleanup: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    setCopilotBridge: vi.fn(),
    setWorktreeManager: vi.fn(),
  } as unknown as AutomationEngine;
}

function createMockBridge(): CopilotBridge {
  return {
    listModels: vi.fn().mockResolvedValue([
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet", vendor: "anthropic" },
    ]),
  } as unknown as CopilotBridge;
}

function createMockDb(): Record<string, unknown> {
  const allFn = vi.fn().mockReturnValue([
    {
      id: "auto-1",
      project_id: "proj-1",
      name: "Test Automation",
      description: null,
      enabled: 1,
      schedule_type: "manual",
      schedule_cron: null,
      schedule_timezone: null,
      schedule_run_at: null,
      schedule_starts_at: null,
      schedule_ends_at: null,
      chain_json: '[{"id":"step-1","name":"analyze","prompt":"Analyze","model":"claude-sonnet-4-20250514","tools":{"builtIn":true,"extensions":"all","mcp":"all"},"onError":"stop"}]',
      system_prompt: null,
      variables_json: null,
      worktree_json: null,
      max_duration_ms: 300000,
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-01T00:00:00.000Z",
      last_run_status: "completed",
      last_run_at: "2025-01-01T01:00:00.000Z",
      last_run_duration: 5000,
    },
  ]);
  return {
    prepare: vi.fn().mockReturnValue({ all: allFn }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Automation REST API", () => {
  let mockEngine: AutomationEngine;
  let mockBridge: CopilotBridge;
  let app: express.Application;

  beforeEach(() => {
    mockEngine = createMockEngine();
    mockBridge = createMockBridge();
    const mockDb = createMockDb();

    setAutomationEngine(mockEngine);
    setCopilotBridge(mockBridge);
    setDb(mockDb as unknown as import("better-sqlite3").Database);

    app = createApp();
  });

  // -----------------------------------------------------------------------
  // GET /api/:pid/automations
  // -----------------------------------------------------------------------

  describe("GET /api/:pid/automations", () => {
    it("returns automations with last run info", async () => {
      const res = await request(app, "GET", "/api/proj-1/automations");
      expect(res.status).toBe(200);
      const list = res.body as Array<Record<string, unknown>>;
      expect(list).toHaveLength(1);
      expect(list[0]!["id"]).toBe("auto-1");
      expect(list[0]!["lastRun"]).toBeDefined();
      const lastRun = list[0]!["lastRun"] as Record<string, unknown>;
      expect(lastRun["status"]).toBe("completed");
      expect(lastRun["startedAt"]).toBe("2025-01-01T01:00:00.000Z");
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/:pid/automations
  // -----------------------------------------------------------------------

  describe("POST /api/:pid/automations", () => {
    it("creates automation with valid input", async () => {
      const input = {
        name: "Test",
        enabled: true,
        schedule: { type: "manual" },
        chain: [
          {
            id: "s1",
            name: "step1",
            prompt: "Do work",
            model: "claude-sonnet-4-20250514",
            tools: { builtIn: true, extensions: "all", mcp: "all" },
            onError: "stop",
          },
        ],
      };
      const res = await request(app, "POST", "/api/proj-1/automations", input);
      expect(res.status).toBe(201);
      expect(
        (mockEngine.createAutomation as ReturnType<typeof vi.fn>),
      ).toHaveBeenCalledWith("proj-1", expect.objectContaining({ name: "Test" }));
    });

    it("returns 400 for missing name", async () => {
      const input = {
        schedule: { type: "manual" },
        chain: [
          {
            id: "s1",
            name: "step1",
            prompt: "Do work",
            model: "m",
            tools: { builtIn: true, extensions: "all", mcp: "all" },
            onError: "stop",
          },
        ],
      };
      const res = await request(app, "POST", "/api/proj-1/automations", input);
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("name");
    });

    it("returns 400 for missing chain", async () => {
      const input = {
        name: "Test",
        schedule: { type: "manual" },
      };
      const res = await request(app, "POST", "/api/proj-1/automations", input);
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("chain");
    });

    it("returns 400 for empty chain", async () => {
      const input = {
        name: "Test",
        schedule: { type: "manual" },
        chain: [],
      };
      const res = await request(app, "POST", "/api/proj-1/automations", input);
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("at least 1");
    });

    it("returns 400 for invalid cron expression", async () => {
      const input = {
        name: "Test",
        schedule: { type: "cron", cron: "invalid-cron" },
        chain: [
          {
            id: "s1",
            name: "step1",
            prompt: "Do work",
            model: "m",
            tools: { builtIn: true, extensions: "all", mcp: "all" },
            onError: "stop",
          },
        ],
      };
      const res = await request(app, "POST", "/api/proj-1/automations", input);
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("Invalid cron");
    });

    it("returns 400 for missing step fields", async () => {
      const input = {
        name: "Test",
        schedule: { type: "manual" },
        chain: [{ id: "s1" }],
      };
      const res = await request(app, "POST", "/api/proj-1/automations", input);
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("chain[0].name");
    });

    it("returns 400 for invalid onError value", async () => {
      const input = {
        name: "Test",
        schedule: { type: "manual" },
        chain: [
          {
            id: "s1",
            name: "step1",
            prompt: "Do work",
            model: "m",
            tools: { builtIn: true, extensions: "all", mcp: "all" },
            onError: "invalid",
          },
        ],
      };
      const res = await request(app, "POST", "/api/proj-1/automations", input);
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("onError");
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/:pid/automations/models
  // -----------------------------------------------------------------------

  describe("GET /api/:pid/automations/models", () => {
    it("returns model list", async () => {
      const res = await request(app, "GET", "/api/proj-1/automations/models");
      expect(res.status).toBe(200);
      const models = res.body as Array<Record<string, unknown>>;
      expect(models).toHaveLength(1);
      expect(models[0]!["id"]).toBe("claude-sonnet-4-20250514");
    });

    it("returns 503 if bridge unavailable", async () => {
      setCopilotBridge(null as unknown as CopilotBridge);
      const res = await request(app, "GET", "/api/proj-1/automations/models");
      expect(res.status).toBe(503);
    });

    it("returns 503 if bridge throws", async () => {
      (mockBridge.listModels as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Bridge error"),
      );
      const res = await request(app, "GET", "/api/proj-1/automations/models");
      expect(res.status).toBe(503);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/:pid/automations/:id
  // -----------------------------------------------------------------------

  describe("GET /api/:pid/automations/:id", () => {
    it("returns automation details", async () => {
      const res = await request(app, "GET", "/api/proj-1/automations/auto-1");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["id"]).toBe("auto-1");
    });

    it("returns 404 for non-existent automation", async () => {
      (mockEngine.getAutomation as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const res = await request(app, "GET", "/api/proj-1/automations/bad-id");
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // PUT /api/:pid/automations/:id
  // -----------------------------------------------------------------------

  describe("PUT /api/:pid/automations/:id", () => {
    it("updates automation", async () => {
      const updates = { name: "Updated Name" };
      const res = await request(app, "PUT", "/api/proj-1/automations/auto-1", updates);
      expect(res.status).toBe(200);
      expect(
        (mockEngine.updateAutomation as ReturnType<typeof vi.fn>),
      ).toHaveBeenCalledWith("auto-1", expect.objectContaining({ name: "Updated Name" }));
    });

    it("returns 404 for non-existent automation", async () => {
      (mockEngine.updateAutomation as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Automation not found: bad-id");
      });
      const res = await request(app, "PUT", "/api/proj-1/automations/bad-id", { name: "X" });
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /api/:pid/automations/:id
  // -----------------------------------------------------------------------

  describe("DELETE /api/:pid/automations/:id", () => {
    it("deletes automation", async () => {
      const res = await request(app, "DELETE", "/api/proj-1/automations/auto-1");
      expect(res.status).toBe(204);
      expect(
        (mockEngine.deleteAutomation as ReturnType<typeof vi.fn>),
      ).toHaveBeenCalledWith("auto-1");
    });

    it("returns 404 for non-existent automation", async () => {
      (mockEngine.getAutomation as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const res = await request(app, "DELETE", "/api/proj-1/automations/bad-id");
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/:pid/automations/:id/toggle
  // -----------------------------------------------------------------------

  describe("POST /api/:pid/automations/:id/toggle", () => {
    it("enables automation", async () => {
      const res = await request(
        app,
        "POST",
        "/api/proj-1/automations/auto-1/toggle",
        { enabled: true },
      );
      expect(res.status).toBe(200);
      expect(
        (mockEngine.toggleAutomation as ReturnType<typeof vi.fn>),
      ).toHaveBeenCalledWith("auto-1", true);
    });

    it("disables automation", async () => {
      const res = await request(
        app,
        "POST",
        "/api/proj-1/automations/auto-1/toggle",
        { enabled: false },
      );
      expect(res.status).toBe(200);
      expect(
        (mockEngine.toggleAutomation as ReturnType<typeof vi.fn>),
      ).toHaveBeenCalledWith("auto-1", false);
    });

    it("returns 400 if enabled is missing", async () => {
      const res = await request(
        app,
        "POST",
        "/api/proj-1/automations/auto-1/toggle",
        {},
      );
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent automation", async () => {
      (mockEngine.toggleAutomation as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Automation not found: bad-id");
      });
      const res = await request(
        app,
        "POST",
        "/api/proj-1/automations/bad-id/toggle",
        { enabled: true },
      );
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/:pid/automations/:id/trigger
  // -----------------------------------------------------------------------

  describe("POST /api/:pid/automations/:id/trigger", () => {
    it("returns 202 with runId", async () => {
      const res = await request(app, "POST", "/api/proj-1/automations/auto-1/trigger");
      expect(res.status).toBe(202);
      expect((res.body as Record<string, unknown>)["runId"]).toBe("run-1");
    });

    it("returns 409 if concurrent run active", async () => {
      (mockEngine.triggerRun as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Automation 'Test' already has an active run");
      });
      const res = await request(app, "POST", "/api/proj-1/automations/auto-1/trigger");
      expect(res.status).toBe(409);
    });

    it("returns 404 for non-existent automation", async () => {
      (mockEngine.triggerRun as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Automation not found: bad-id");
      });
      const res = await request(app, "POST", "/api/proj-1/automations/bad-id/trigger");
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/:pid/automations/:id/runs
  // -----------------------------------------------------------------------

  describe("GET /api/:pid/automations/:id/runs", () => {
    it("returns run history", async () => {
      const res = await request(app, "GET", "/api/proj-1/automations/auto-1/runs");
      expect(res.status).toBe(200);
      const runs = res.body as Array<Record<string, unknown>>;
      expect(runs).toHaveLength(1);
      expect(runs[0]!["id"]).toBe("run-1");
    });

    it("passes query params to engine", async () => {
      await request(
        app,
        "GET",
        "/api/proj-1/automations/auto-1/runs?status=completed&limit=5",
      );
      expect(
        (mockEngine.listRuns as ReturnType<typeof vi.fn>),
      ).toHaveBeenCalledWith("auto-1", { status: "completed", limit: 5 });
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/:pid/automations/:id/runs/:runId
  // -----------------------------------------------------------------------

  describe("GET /api/:pid/automations/:id/runs/:runId", () => {
    it("returns run details", async () => {
      const res = await request(
        app,
        "GET",
        "/api/proj-1/automations/auto-1/runs/run-1",
      );
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["id"]).toBe("run-1");
    });

    it("returns 404 for non-existent run", async () => {
      (mockEngine.getRunDetails as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const res = await request(
        app,
        "GET",
        "/api/proj-1/automations/auto-1/runs/bad-id",
      );
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/:pid/automations/:id/runs/:runId/cancel
  // -----------------------------------------------------------------------

  describe("POST /api/:pid/automations/:id/runs/:runId/cancel", () => {
    it("cancels a running run", async () => {
      const res = await request(
        app,
        "POST",
        "/api/proj-1/automations/auto-1/runs/run-1/cancel",
      );
      expect(res.status).toBe(200);
      expect(
        (mockEngine.cancelRun as ReturnType<typeof vi.fn>),
      ).toHaveBeenCalledWith("run-1");
    });

    it("returns 404 for non-active run", async () => {
      (mockEngine.cancelRun as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("No active run found: bad-id");
      });
      const res = await request(
        app,
        "POST",
        "/api/proj-1/automations/auto-1/runs/bad-id/cancel",
      );
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // Log cleanup (via engine method)
  // -----------------------------------------------------------------------

  describe("Log cleanup", () => {
    it("runLogCleanup is callable on engine", () => {
      const eng = mockEngine;
      eng.runLogCleanup();
      expect(
        (eng.runLogCleanup as ReturnType<typeof vi.fn>),
      ).toHaveBeenCalled();
    });

    it("runLogCleanup accepts custom retention", () => {
      const eng = mockEngine;
      eng.runLogCleanup(60, 15);
      expect(
        (eng.runLogCleanup as ReturnType<typeof vi.fn>),
      ).toHaveBeenCalledWith(60, 15);
    });
  });
});
