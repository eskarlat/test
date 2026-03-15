import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mockApiGet = vi.fn();
vi.mock("./client", () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
  BASE_URL: "http://localhost:42888",
}));

import {
  useHealth,
  useMCPStatus,
  useSessions,
  useHookActivity,
  useAPIUsage,
  useLogs,
} from "./hooks";

describe("api/hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ data: null, error: null, status: 200 });
  });

  describe("useHealth", () => {
    it("fetches health data", async () => {
      mockApiGet.mockResolvedValue({
        data: { status: "ok", port: 42888, uptime: 100 },
        error: null,
        status: 200,
      });

      const { result } = renderHook(() => useHealth());
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(result.current.data?.status).toBe("ok");
      expect(mockApiGet).toHaveBeenCalledWith("/health");
    });
  });

  describe("useMCPStatus", () => {
    it("fetches MCP status for project", async () => {
      mockApiGet.mockResolvedValue({ data: [], error: null, status: 200 });

      const { result } = renderHook(() => useMCPStatus("proj-1"));
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/mcp/status");
    });

    it("skips fetch when projectId is null", async () => {
      const { result } = renderHook(() => useMCPStatus(null));
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(mockApiGet).not.toHaveBeenCalled();
    });
  });

  describe("useSessions", () => {
    it("fetches sessions for project", async () => {
      mockApiGet.mockResolvedValue({ data: [{ id: "s1" }], error: null, status: 200 });

      const { result } = renderHook(() => useSessions("proj-1"));
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(result.current.data).toHaveLength(1);
    });
  });

  describe("useHookActivity", () => {
    it("fetches hook activity", async () => {
      mockApiGet.mockResolvedValue({ data: [], error: null, status: 200 });

      const { result } = renderHook(() => useHookActivity("proj-1"));
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/hooks/activity");
    });
  });

  describe("useAPIUsage", () => {
    it("fetches API usage stats", async () => {
      mockApiGet.mockResolvedValue({ data: [], error: null, status: 200 });

      const { result } = renderHook(() => useAPIUsage("proj-1"));
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/stats/api");
    });
  });

  describe("useLogs", () => {
    it("fetches logs for project", async () => {
      mockApiGet.mockResolvedValue({ data: [], error: null, status: 200 });

      const { result } = renderHook(() => useLogs("proj-1", 20));
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/logs?limit=20");
    });

    it("fetches global logs when no projectId", async () => {
      mockApiGet.mockResolvedValue({ data: [], error: null, status: 200 });

      const { result } = renderHook(() => useLogs(null));
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(mockApiGet).toHaveBeenCalledWith("/api/logs?limit=10");
    });
  });

  describe("error handling", () => {
    it("sets error on API failure", async () => {
      mockApiGet.mockResolvedValue({ data: null, error: "Connection failed", status: 500 });

      const { result } = renderHook(() => useHealth());
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(result.current.error).toBe("Connection failed");
      expect(result.current.data).toBeNull();
    });

    it("treats 404 as empty (not error)", async () => {
      mockApiGet.mockResolvedValue({ data: null, error: "Not found", status: 404 });

      const { result } = renderHook(() => useHealth());
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(result.current.error).toBeNull();
      expect(result.current.data).toBeNull();
    });
  });

  describe("reload", () => {
    it("provides reload function", async () => {
      mockApiGet.mockResolvedValue({
        data: { status: "ok", port: 42888, uptime: 100 },
        error: null,
        status: 200,
      });

      const { result } = renderHook(() => useHealth());
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(typeof result.current.reload).toBe("function");
    });
  });
});
