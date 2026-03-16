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

import { apiGet, apiPut } from "../api/client";
import { useErrorStore } from "./error-store";
import type { ErrorPattern } from "./error-store";

const mockApiGet = vi.mocked(apiGet);
const mockApiPut = vi.mocked(apiPut);

function makePattern(overrides: Partial<ErrorPattern> = {}): ErrorPattern {
  return {
    id: "err-1",
    projectId: "proj-1",
    fingerprint: "abc123",
    messageTemplate: "Cannot read property 'x' of undefined",
    occurrenceCount: 5,
    sessionCount: 2,
    status: "active",
    firstSeenAt: "2026-01-01T00:00:00Z",
    lastSeenAt: "2026-01-15T00:00:00Z",
    ...overrides,
  };
}

describe("error-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useErrorStore.setState({
      patterns: [],
      trends: [],
      loading: false,
      error: null,
    });
  });

  describe("fetchPatterns", () => {
    it("populates patterns on success", async () => {
      const patterns = [makePattern(), makePattern({ id: "err-2", fingerprint: "def456" })];
      mockApiGet.mockResolvedValueOnce({ data: patterns, error: null, status: 200 });

      await useErrorStore.getState().fetchPatterns("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/errors");
      expect(useErrorStore.getState().patterns).toEqual(patterns);
      expect(useErrorStore.getState().loading).toBe(false);
      expect(useErrorStore.getState().error).toBeNull();
    });

    it("sets error on failure", async () => {
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Server error", status: 500 });

      await useErrorStore.getState().fetchPatterns("proj-1");

      expect(useErrorStore.getState().patterns).toEqual([]);
      expect(useErrorStore.getState().error).toBe("Server error");
      expect(useErrorStore.getState().loading).toBe(false);
    });
  });

  describe("fetchTrends", () => {
    it("populates trends on success", async () => {
      const trends = [
        { date: "2026-01-01", count: 3 },
        { date: "2026-01-02", count: 7 },
      ];
      mockApiGet.mockResolvedValueOnce({ data: trends, error: null, status: 200 });

      await useErrorStore.getState().fetchTrends("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/errors/trends");
      expect(useErrorStore.getState().trends).toEqual(trends);
    });

    it("does not update trends on failure", async () => {
      useErrorStore.setState({ trends: [{ date: "2026-01-01", count: 1 }] });
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Not found", status: 404 });

      await useErrorStore.getState().fetchTrends("proj-1");

      expect(useErrorStore.getState().trends).toEqual([{ date: "2026-01-01", count: 1 }]);
    });
  });

  describe("updatePattern", () => {
    it("updates the pattern in the list", async () => {
      const original = makePattern({ id: "err-1", status: "active" });
      const updated = makePattern({ id: "err-1", status: "resolved", resolutionNote: "Fixed in v2" });
      useErrorStore.setState({ patterns: [original] });
      mockApiPut.mockResolvedValueOnce({ data: updated, error: null, status: 200 });

      await useErrorStore.getState().updatePattern("proj-1", "err-1", {
        status: "resolved",
        resolutionNote: "Fixed in v2",
      });

      expect(mockApiPut).toHaveBeenCalledWith("/api/proj-1/errors/err-1", {
        status: "resolved",
        resolutionNote: "Fixed in v2",
      });
      expect(useErrorStore.getState().patterns[0]!.status).toBe("resolved");
      expect(useErrorStore.getState().patterns[0]!.resolutionNote).toBe("Fixed in v2");
    });

    it("does not update on API failure", async () => {
      const original = makePattern({ id: "err-1", status: "active" });
      useErrorStore.setState({ patterns: [original] });
      mockApiPut.mockResolvedValueOnce({ data: null, error: "Forbidden", status: 403 });

      await useErrorStore.getState().updatePattern("proj-1", "err-1", { status: "resolved" });

      expect(useErrorStore.getState().patterns[0]!.status).toBe("active");
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      useErrorStore.setState({
        patterns: [makePattern()],
        trends: [{ date: "2026-01-01", count: 1 }],
        loading: true,
        error: "some error",
      });

      useErrorStore.getState().reset();

      const state = useErrorStore.getState();
      expect(state.patterns).toEqual([]);
      expect(state.trends).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });
});
