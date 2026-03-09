import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAutomationStore } from "./automation-store";
import type {
  AutomationListItem,
  AutomationRun,
  RunStartedEvent,
  RunCompletedEvent,
} from "../types/automation";

// Mock the API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  BASE_URL: "http://localhost:42888",
}));

// Mock the socket store
vi.mock("../api/socket", () => ({
  useSocketStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ socket: { emit: vi.fn() } }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

import { apiGet, apiPost, apiPut, apiDelete } from "../api/client";

const mockApiGet = vi.mocked(apiGet);
const mockApiPost = vi.mocked(apiPost);
const mockApiPut = vi.mocked(apiPut);
const mockApiDelete = vi.mocked(apiDelete);

function makeListItem(overrides: Partial<AutomationListItem> = {}): AutomationListItem {
  return {
    id: "auto-1",
    projectId: "proj-1",
    name: "Test Automation",
    enabled: true,
    scheduleType: "manual",
    chainStepCount: 2,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    projectId: "proj-1",
    status: "completed",
    triggerType: "manual",
    startedAt: "2026-01-01T00:00:00Z",
    durationMs: 5000,
    stepCount: 2,
    stepsCompleted: 2,
    totalInputTokens: 100,
    totalOutputTokens: 200,
    ...overrides,
  };
}

describe("automation-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAutomationStore.setState({
      automations: [],
      extensionJobs: [],
      models: [],
      loading: false,
      error: null,
      runs: [],
      activeRun: null,
      runLoading: false,
    });
  });

  describe("fetchAutomations", () => {
    it("sets automations from API response", async () => {
      const items = [makeListItem(), makeListItem({ id: "auto-2", name: "Second" })];
      mockApiGet.mockResolvedValueOnce({ data: items, error: null, status: 200 });

      await useAutomationStore.getState().fetchAutomations("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/automations");
      expect(useAutomationStore.getState().automations).toEqual(items);
      expect(useAutomationStore.getState().loading).toBe(false);
      expect(useAutomationStore.getState().error).toBeNull();
    });

    it("sets error when API fails", async () => {
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Server error", status: 500 });

      await useAutomationStore.getState().fetchAutomations("proj-1");

      expect(useAutomationStore.getState().automations).toEqual([]);
      expect(useAutomationStore.getState().error).toBe("Server error");
      expect(useAutomationStore.getState().loading).toBe(false);
    });
  });

  describe("createAutomation", () => {
    it("adds to store on success", async () => {
      const fullAutomation = {
        id: "auto-new",
        projectId: "proj-1",
        name: "New Automation",
        enabled: false,
        schedule: { type: "manual" as const },
        chain: [
          {
            id: "s1",
            name: "step1",
            prompt: "do something",
            model: "claude-3",
            tools: { builtIn: true, extensions: "all" as const, mcp: "all" as const },
            onError: "stop" as const,
          },
        ],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      mockApiPost.mockResolvedValueOnce({ data: fullAutomation, error: null, status: 201 });

      const result = await useAutomationStore.getState().createAutomation("proj-1", {
        name: "New Automation",
        schedule: { type: "manual" },
        chain: fullAutomation.chain,
      });

      expect(result).toEqual(fullAutomation);
      expect(useAutomationStore.getState().automations).toHaveLength(1);
      const item = useAutomationStore.getState().automations[0]!;
      expect(item.id).toBe("auto-new");
      expect(item.name).toBe("New Automation");
      expect(item.enabled).toBe(false);
      expect(item.scheduleType).toBe("manual");
      expect(item.chainStepCount).toBe(1);
    });

    it("throws on API error", async () => {
      mockApiPost.mockResolvedValueOnce({ data: null, error: "Validation failed", status: 400 });

      await expect(
        useAutomationStore.getState().createAutomation("proj-1", {
          name: "Bad",
          schedule: { type: "manual" },
          chain: [],
        }),
      ).rejects.toThrow("Validation failed");
    });
  });

  describe("toggleAutomation", () => {
    it("updates enabled field in store", async () => {
      useAutomationStore.setState({
        automations: [makeListItem({ id: "auto-1", enabled: true })],
      });
      mockApiPost.mockResolvedValueOnce({ data: { ok: true }, error: null, status: 200 });

      await useAutomationStore.getState().toggleAutomation("proj-1", "auto-1", false);

      expect(mockApiPost).toHaveBeenCalledWith(
        "/api/proj-1/automations/auto-1/toggle",
        { enabled: false },
      );
      expect(useAutomationStore.getState().automations[0]!.enabled).toBe(false);
    });

    it("throws on API error", async () => {
      useAutomationStore.setState({ automations: [makeListItem()] });
      mockApiPost.mockResolvedValueOnce({ data: null, error: "Not found", status: 404 });

      await expect(
        useAutomationStore.getState().toggleAutomation("proj-1", "auto-1", false),
      ).rejects.toThrow("Not found");
    });
  });

  describe("updateAutomation", () => {
    it("updates the automation in the list", async () => {
      useAutomationStore.setState({ automations: [makeListItem({ id: "auto-1" })] });
      const updated = {
        id: "auto-1",
        projectId: "proj-1",
        name: "Renamed",
        enabled: true,
        schedule: { type: "cron" as const, cron: "0 * * * *" },
        chain: [
          {
            id: "s1",
            name: "step1",
            prompt: "do it",
            model: "claude-3",
            tools: { builtIn: true, extensions: "all" as const, mcp: "all" as const },
            onError: "stop" as const,
          },
          {
            id: "s2",
            name: "step2",
            prompt: "finish",
            model: "claude-3",
            tools: { builtIn: true, extensions: "all" as const, mcp: "all" as const },
            onError: "stop" as const,
          },
        ],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
      };
      mockApiPut.mockResolvedValueOnce({ data: updated, error: null, status: 200 });

      const result = await useAutomationStore.getState().updateAutomation("proj-1", "auto-1", {
        name: "Renamed",
        schedule: { type: "cron", cron: "0 * * * *" },
      });

      expect(result).toEqual(updated);
      const item = useAutomationStore.getState().automations[0]!;
      expect(item.name).toBe("Renamed");
      expect(item.scheduleType).toBe("cron");
      expect(item.scheduleCron).toBe("0 * * * *");
      expect(item.chainStepCount).toBe(2);
    });

    it("throws on API error", async () => {
      mockApiPut.mockResolvedValueOnce({ data: null, error: "Update failed", status: 500 });

      await expect(
        useAutomationStore.getState().updateAutomation("proj-1", "auto-1", { name: "X" }),
      ).rejects.toThrow("Update failed");
    });
  });

  describe("deleteAutomation", () => {
    it("removes the automation from the list", async () => {
      useAutomationStore.setState({
        automations: [makeListItem({ id: "auto-1" }), makeListItem({ id: "auto-2" })],
      });
      mockApiDelete.mockResolvedValueOnce({ data: { ok: true }, error: null, status: 204 });

      await useAutomationStore.getState().deleteAutomation("proj-1", "auto-1");

      expect(useAutomationStore.getState().automations).toHaveLength(1);
      expect(useAutomationStore.getState().automations[0]!.id).toBe("auto-2");
    });

    it("throws on API error", async () => {
      mockApiDelete.mockResolvedValueOnce({ data: null, error: "Forbidden", status: 403 });

      await expect(
        useAutomationStore.getState().deleteAutomation("proj-1", "auto-1"),
      ).rejects.toThrow("Forbidden");
    });
  });

  describe("triggerRun", () => {
    it("returns the run ID", async () => {
      mockApiPost.mockResolvedValueOnce({ data: { runId: "run-abc" }, error: null, status: 200 });

      const runId = await useAutomationStore.getState().triggerRun("proj-1", "auto-1");

      expect(runId).toBe("run-abc");
      expect(mockApiPost).toHaveBeenCalledWith(
        "/api/proj-1/automations/auto-1/trigger",
        {},
      );
    });

    it("throws on API error", async () => {
      mockApiPost.mockResolvedValueOnce({ data: null, error: "Automation disabled", status: 400 });

      await expect(
        useAutomationStore.getState().triggerRun("proj-1", "auto-1"),
      ).rejects.toThrow("Automation disabled");
    });
  });

  describe("socket event handlers", () => {
    it("onRunStarted updates lastRun with status running", () => {
      useAutomationStore.setState({
        automations: [makeListItem({ id: "auto-1" })],
      });
      const event: RunStartedEvent = {
        automationId: "auto-1",
        runId: "run-1",
        automationName: "Test Automation",
        trigger: "manual",
      };

      useAutomationStore.getState().onRunStarted(event);

      const item = useAutomationStore.getState().automations[0]!;
      expect(item.lastRun).toBeDefined();
      expect(item.lastRun!.status).toBe("running");
      expect(item.lastRun!.durationMs).toBeNull();
    });

    it("onRunStarted does not affect other automations", () => {
      useAutomationStore.setState({
        automations: [makeListItem({ id: "auto-1" }), makeListItem({ id: "auto-2" })],
      });
      const event: RunStartedEvent = {
        automationId: "auto-1",
        runId: "run-1",
        automationName: "Test Automation",
        trigger: "manual",
      };

      useAutomationStore.getState().onRunStarted(event);

      expect(useAutomationStore.getState().automations[1]!.lastRun).toBeUndefined();
    });

    it("onRunCompleted updates lastRun with final status and durationMs", () => {
      useAutomationStore.setState({
        automations: [
          makeListItem({
            id: "auto-1",
            lastRun: { status: "running", startedAt: "2026-01-01T00:00:00Z", durationMs: null },
          }),
        ],
      });
      const event: RunCompletedEvent = {
        automationId: "auto-1",
        runId: "run-1",
        status: "completed",
        durationMs: 12345,
      };

      useAutomationStore.getState().onRunCompleted(event);

      const item = useAutomationStore.getState().automations[0]!;
      expect(item.lastRun).toBeDefined();
      expect(item.lastRun!.status).toBe("completed");
      expect(item.lastRun!.durationMs).toBe(12345);
      expect(item.lastRun!.startedAt).toBe("2026-01-01T00:00:00Z");
    });

    it("onRunCompleted handles failed status", () => {
      useAutomationStore.setState({
        automations: [
          makeListItem({
            id: "auto-1",
            lastRun: { status: "running", startedAt: "2026-01-01T00:00:00Z", durationMs: null },
          }),
        ],
      });
      const event: RunCompletedEvent = {
        automationId: "auto-1",
        runId: "run-1",
        status: "failed",
        durationMs: 500,
      };

      useAutomationStore.getState().onRunCompleted(event);

      expect(useAutomationStore.getState().automations[0]!.lastRun!.status).toBe("failed");
      expect(useAutomationStore.getState().automations[0]!.lastRun!.durationMs).toBe(500);
    });
  });

  describe("fetchRuns", () => {
    it("populates runs array", async () => {
      const runs = [makeRun({ id: "run-1" }), makeRun({ id: "run-2", status: "failed" })];
      mockApiGet.mockResolvedValueOnce({ data: runs, error: null, status: 200 });

      await useAutomationStore.getState().fetchRuns("proj-1", "auto-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/automations/auto-1/runs");
      expect(useAutomationStore.getState().runs).toEqual(runs);
      expect(useAutomationStore.getState().runLoading).toBe(false);
    });

    it("passes query parameters", async () => {
      mockApiGet.mockResolvedValueOnce({ data: [], error: null, status: 200 });

      await useAutomationStore.getState().fetchRuns("proj-1", "auto-1", {
        limit: 10,
        status: "completed",
      });

      expect(mockApiGet).toHaveBeenCalledWith(
        "/api/proj-1/automations/auto-1/runs?limit=10&status=completed",
      );
    });

    it("handles API failure gracefully", async () => {
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Not found", status: 404 });

      await useAutomationStore.getState().fetchRuns("proj-1", "auto-1");

      expect(useAutomationStore.getState().runs).toEqual([]);
      expect(useAutomationStore.getState().runLoading).toBe(false);
    });
  });

  describe("cancelRun", () => {
    it("updates run status to cancelled", async () => {
      useAutomationStore.setState({
        runs: [makeRun({ id: "run-1", status: "running" })],
      });
      mockApiPost.mockResolvedValueOnce({ data: { ok: true }, error: null, status: 200 });

      await useAutomationStore.getState().cancelRun("proj-1", "auto-1", "run-1");

      expect(mockApiPost).toHaveBeenCalledWith(
        "/api/proj-1/automations/auto-1/runs/run-1/cancel",
        {},
      );
      expect(useAutomationStore.getState().runs[0]!.status).toBe("cancelled");
    });

    it("updates activeRun if it matches", async () => {
      const activeRun = {
        ...makeRun({ id: "run-1", status: "running" }),
        steps: [],
      };
      useAutomationStore.setState({
        runs: [makeRun({ id: "run-1", status: "running" })],
        activeRun,
      });
      mockApiPost.mockResolvedValueOnce({ data: { ok: true }, error: null, status: 200 });

      await useAutomationStore.getState().cancelRun("proj-1", "auto-1", "run-1");

      expect(useAutomationStore.getState().activeRun!.status).toBe("cancelled");
    });

    it("throws on API error", async () => {
      useAutomationStore.setState({
        runs: [makeRun({ id: "run-1", status: "running" })],
      });
      mockApiPost.mockResolvedValueOnce({ data: null, error: "Already completed", status: 409 });

      await expect(
        useAutomationStore.getState().cancelRun("proj-1", "auto-1", "run-1"),
      ).rejects.toThrow("Already completed");
    });
  });

  describe("fetchExtensionJobs", () => {
    it("populates extensionJobs", async () => {
      const jobs = [
        {
          id: "job-1",
          extensionName: "my-ext",
          name: "daily-sync",
          cron: "0 0 * * *",
          timezone: null,
          enabled: true,
          description: null,
          timeoutMs: null,
          lastRunAt: null,
          lastRunStatus: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ];
      mockApiGet.mockResolvedValueOnce({ data: jobs, error: null, status: 200 });

      await useAutomationStore.getState().fetchExtensionJobs("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/ext-cron");
      expect(useAutomationStore.getState().extensionJobs).toEqual(jobs);
    });
  });

  describe("fetchModels", () => {
    it("populates models", async () => {
      const models = [
        { id: "claude-3", name: "Claude 3" },
        { id: "claude-4", name: "Claude 4", capabilities: ["reasoning"] },
      ];
      mockApiGet.mockResolvedValueOnce({ data: models, error: null, status: 200 });

      await useAutomationStore.getState().fetchModels("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/automations/models");
      expect(useAutomationStore.getState().models).toEqual(models);
    });
  });
});
