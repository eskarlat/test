import { describe, it, expect, vi, beforeEach } from "vitest";
import { useToolAnalyticsStore } from "./tool-analytics-store";
import type { ToolAnalytics, ToolWarning } from "./tool-analytics-store";

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

const mockApiGet = vi.mocked(apiGet);

function makeAnalytics(overrides: Partial<ToolAnalytics> = {}): ToolAnalytics {
  return {
    byTool: { "file_edit": 10, "bash": 5 },
    successRate: 0.95,
    fileHotspots: [{ filePath: "/src/index.ts", count: 8 }],
    totalCount: 15,
    mostTouchedFiles: [{ filePath: "/src/index.ts", count: 8 }],
    ...overrides,
  };
}

function makeWarning(overrides: Partial<ToolWarning> = {}): ToolWarning {
  return {
    type: "excessive-use",
    sessionId: "sess-1",
    detail: "Tool bash used 50 times in one session",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("tool-analytics-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolAnalyticsStore.setState({
      analytics: null,
      warnings: [],
      loading: false,
      error: null,
    });
  });

  describe("initial state", () => {
    it("has null analytics and empty warnings", () => {
      const state = useToolAnalyticsStore.getState();
      expect(state.analytics).toBeNull();
      expect(state.warnings).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe("fetchAnalytics", () => {
    it("sets analytics data on success", async () => {
      const analytics = makeAnalytics();
      mockApiGet.mockResolvedValueOnce({ data: analytics, error: null, status: 200 });

      await useToolAnalyticsStore.getState().fetchAnalytics("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/tools/analytics");
      expect(useToolAnalyticsStore.getState().analytics).toEqual(analytics);
      expect(useToolAnalyticsStore.getState().loading).toBe(false);
      expect(useToolAnalyticsStore.getState().error).toBeNull();
    });

    it("sets error when API fails", async () => {
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Server error", status: 500 });

      await useToolAnalyticsStore.getState().fetchAnalytics("proj-1");

      expect(useToolAnalyticsStore.getState().analytics).toBeNull();
      expect(useToolAnalyticsStore.getState().error).toBe("Server error");
      expect(useToolAnalyticsStore.getState().loading).toBe(false);
    });
  });

  describe("fetchWarnings", () => {
    it("sets warnings on success", async () => {
      const warnings = [makeWarning(), makeWarning({ type: "denied", sessionId: "sess-2" })];
      mockApiGet.mockResolvedValueOnce({ data: warnings, error: null, status: 200 });

      await useToolAnalyticsStore.getState().fetchWarnings("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/tools/warnings");
      expect(useToolAnalyticsStore.getState().warnings).toEqual(warnings);
    });

    it("does not update warnings on API failure", async () => {
      useToolAnalyticsStore.setState({ warnings: [makeWarning()] });
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Not found", status: 404 });

      await useToolAnalyticsStore.getState().fetchWarnings("proj-1");

      expect(useToolAnalyticsStore.getState().warnings).toHaveLength(1);
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      useToolAnalyticsStore.setState({
        analytics: makeAnalytics(),
        warnings: [makeWarning()],
        loading: true,
        error: "some error",
      });

      useToolAnalyticsStore.getState().reset();

      const state = useToolAnalyticsStore.getState();
      expect(state.analytics).toBeNull();
      expect(state.warnings).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });
});
