import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { apiGet, apiDelete } from "../api/client";
import { usePromptStore } from "./prompt-store";
import type { Prompt, PromptStats, PromptFilter } from "./prompt-store";

const mockApiGet = vi.mocked(apiGet);
const mockApiDelete = vi.mocked(apiDelete);

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: "prompt-1",
    projectId: "proj-1",
    agent: "claude",
    intent: "code-generation",
    promptPreview: "Write a function that...",
    tokenCount: 150,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const defaultFilter: PromptFilter = {
  intent: undefined,
  agent: undefined,
  dateFrom: undefined,
  dateTo: undefined,
  search: undefined,
};

describe("prompt-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptStore.setState({
      prompts: [],
      stats: null,
      loading: false,
      error: null,
      filter: { ...defaultFilter },
    });
  });

  describe("fetchPrompts", () => {
    it("populates prompts on success", async () => {
      const prompts = [makePrompt(), makePrompt({ id: "prompt-2", intent: "debugging" })];
      mockApiGet.mockResolvedValueOnce({ data: prompts, error: null, status: 200 });

      await usePromptStore.getState().fetchPrompts("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/prompts");
      expect(usePromptStore.getState().prompts).toEqual(prompts);
      expect(usePromptStore.getState().loading).toBe(false);
      expect(usePromptStore.getState().error).toBeNull();
    });

    it("sets error on failure", async () => {
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Server error", status: 500 });

      await usePromptStore.getState().fetchPrompts("proj-1");

      expect(usePromptStore.getState().prompts).toEqual([]);
      expect(usePromptStore.getState().error).toBe("Server error");
      expect(usePromptStore.getState().loading).toBe(false);
    });
  });

  describe("fetchStats", () => {
    it("populates stats on success", async () => {
      const stats: PromptStats = {
        total: 42,
        byIntent: { "code-generation": 20, debugging: 12, "code-review": 10 },
        byAgent: { claude: 30, copilot: 12 },
      };
      mockApiGet.mockResolvedValueOnce({ data: stats, error: null, status: 200 });

      await usePromptStore.getState().fetchStats("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/prompts/stats");
      expect(usePromptStore.getState().stats).toEqual(stats);
    });

    it("does not update stats on failure", async () => {
      const existingStats: PromptStats = { total: 10, byIntent: {}, byAgent: {} };
      usePromptStore.setState({ stats: existingStats });
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Not found", status: 404 });

      await usePromptStore.getState().fetchStats("proj-1");

      expect(usePromptStore.getState().stats).toEqual(existingStats);
    });
  });

  describe("deletePrompt", () => {
    it("removes prompt from list", async () => {
      usePromptStore.setState({
        prompts: [makePrompt({ id: "prompt-1" }), makePrompt({ id: "prompt-2" })],
      });
      mockApiDelete.mockResolvedValueOnce({ data: { ok: true }, error: null, status: 204 });

      await usePromptStore.getState().deletePrompt("proj-1", "prompt-1");

      expect(mockApiDelete).toHaveBeenCalledWith("/api/proj-1/prompts/prompt-1");
      const prompts = usePromptStore.getState().prompts;
      expect(prompts).toHaveLength(1);
      expect(prompts[0]!.id).toBe("prompt-2");
    });
  });

  describe("setFilter", () => {
    it("merges partial filter", () => {
      usePromptStore.getState().setFilter({ intent: "debugging" });

      expect(usePromptStore.getState().filter.intent).toBe("debugging");
      expect(usePromptStore.getState().filter.agent).toBeUndefined();
    });

    it("merges multiple filter fields", () => {
      usePromptStore.getState().setFilter({ intent: "debugging", agent: "claude" });

      expect(usePromptStore.getState().filter.intent).toBe("debugging");
      expect(usePromptStore.getState().filter.agent).toBe("claude");
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      usePromptStore.setState({
        prompts: [makePrompt()],
        stats: { total: 10, byIntent: {}, byAgent: {} },
        loading: true,
        error: "some error",
        filter: { intent: "debugging", agent: "claude", dateFrom: "2026-01-01", dateTo: "2026-02-01", search: "test" },
      });

      usePromptStore.getState().reset();

      const state = usePromptStore.getState();
      expect(state.prompts).toEqual([]);
      expect(state.stats).toBeNull();
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.filter).toEqual(defaultFilter);
    });
  });
});
