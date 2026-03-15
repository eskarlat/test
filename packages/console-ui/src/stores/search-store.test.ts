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

import { apiGet } from "../api/client";
import { useSearchStore } from "./search-store";
import type { SearchResult } from "./search-store";

const mockApiGet = vi.mocked(apiGet);

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    table: "observations",
    id: "res-1",
    projectId: "proj-1",
    preview: "User prefers TypeScript",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("search-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchStore.setState({
      query: "",
      results: [],
      loading: false,
      error: null,
      activeFilters: [],
    });
  });

  describe("search", () => {
    it("fetches results on non-empty query", async () => {
      const results = [makeResult(), makeResult({ id: "res-2", table: "prompts" })];
      mockApiGet.mockResolvedValueOnce({ data: results, error: null, status: 200 });

      await useSearchStore.getState().search("proj-1", "TypeScript");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/search?q=TypeScript");
      expect(useSearchStore.getState().results).toEqual(results);
      expect(useSearchStore.getState().query).toBe("TypeScript");
      expect(useSearchStore.getState().loading).toBe(false);
    });

    it("clears results on empty query", async () => {
      useSearchStore.setState({ results: [makeResult()], query: "old" });

      await useSearchStore.getState().search("proj-1", "  ");

      expect(mockApiGet).not.toHaveBeenCalled();
      expect(useSearchStore.getState().results).toEqual([]);
      expect(useSearchStore.getState().loading).toBe(false);
    });

    it("sets error on API failure", async () => {
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Search failed", status: 500 });

      await useSearchStore.getState().search("proj-1", "test");

      expect(useSearchStore.getState().error).toBe("Search failed");
      expect(useSearchStore.getState().loading).toBe(false);
    });
  });

  describe("setQuery", () => {
    it("sets query string", () => {
      useSearchStore.getState().setQuery("hello");

      expect(useSearchStore.getState().query).toBe("hello");
    });
  });

  describe("toggleFilter", () => {
    it("adds filter when not present", () => {
      useSearchStore.getState().toggleFilter("observations");

      expect(useSearchStore.getState().activeFilters).toEqual(["observations"]);
    });

    it("removes filter when already present", () => {
      useSearchStore.setState({ activeFilters: ["observations", "prompts"] });

      useSearchStore.getState().toggleFilter("observations");

      expect(useSearchStore.getState().activeFilters).toEqual(["prompts"]);
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      useSearchStore.setState({
        query: "test",
        results: [makeResult()],
        loading: true,
        error: "some error",
        activeFilters: ["observations"],
      });

      useSearchStore.getState().reset();

      const state = useSearchStore.getState();
      expect(state.query).toBe("");
      expect(state.results).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.activeFilters).toEqual([]);
    });
  });
});
