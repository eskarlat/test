import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock pid module to control getBaseUrl behavior
vi.mock("../utils/pid.js", () => ({
  readServerState: vi.fn(),
}));

import { readServerState } from "../utils/pid.js";
const mockReadServerState = vi.mocked(readServerState);

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe("server-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadServerState.mockReturnValue({
      pid: 1234,
      port: 42888,
      startedAt: "2026-01-01T00:00:00Z",
      activeProjects: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("checkHealth", () => {
    it("returns health data on success", async () => {
      const healthData = {
        status: "ok",
        uptime: 100,
        memoryUsage: {},
        port: 42888,
        version: "0.1.0",
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(healthData),
      });
      const { checkHealth } = await import("./server-client.js");
      const result = await checkHealth();
      expect(result).toEqual(healthData);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:42888/health",
        expect.any(Object),
      );
    });

    it("returns null when no server state", async () => {
      mockReadServerState.mockReturnValue(null);
      const { checkHealth } = await import("./server-client.js");
      const result = await checkHealth();
      expect(result).toBeNull();
    });

    it("returns null on fetch error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
      const { checkHealth } = await import("./server-client.js");
      const result = await checkHealth();
      expect(result).toBeNull();
    });

    it("uses provided port override", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "ok" }),
      });
      const { checkHealth } = await import("./server-client.js");
      await checkHealth(9999);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:9999/health",
        expect.any(Object),
      );
    });

    it("returns null on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      const { checkHealth } = await import("./server-client.js");
      const result = await checkHealth();
      expect(result).toBeNull();
    });
  });

  describe("isRenreKitServer", () => {
    it("returns true when health status is ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "ok" }),
      });
      const { isRenreKitServer } = await import("./server-client.js");
      const result = await isRenreKitServer(42888);
      expect(result).toBe(true);
    });

    it("returns false when health fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("fail"));
      const { isRenreKitServer } = await import("./server-client.js");
      const result = await isRenreKitServer(42888);
      expect(result).toBe(false);
    });
  });

  describe("registerProject", () => {
    it("sends POST and returns response", async () => {
      const response = { success: true, projectId: "proj-1", extensions: [] };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response),
      });
      const { registerProject } = await import("./server-client.js");
      const result = await registerProject("proj-1", "My Project", "/path");
      expect(result).toEqual(response);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:42888/api/projects/register",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ id: "proj-1", name: "My Project", path: "/path" }),
        }),
      );
    });

    it("returns null when no server state", async () => {
      mockReadServerState.mockReturnValue(null);
      const { registerProject } = await import("./server-client.js");
      const result = await registerProject("proj-1", "Test", "/path");
      expect(result).toBeNull();
    });
  });

  describe("unregisterProject", () => {
    it("returns true on success", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const { unregisterProject } = await import("./server-client.js");
      const result = await unregisterProject("proj-1");
      expect(result).toBe(true);
    });

    it("returns false on failure", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      const { unregisterProject } = await import("./server-client.js");
      const result = await unregisterProject("proj-1");
      expect(result).toBe(false);
    });
  });

  describe("listProjects", () => {
    it("returns projects array", async () => {
      const projects = [{ id: "p1", name: "Test", path: "/test", extensionCount: 0, mountedExtensions: [] }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(projects),
      });
      const { listProjects } = await import("./server-client.js");
      const result = await listProjects();
      expect(result).toEqual(projects);
    });

    it("returns empty array on error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("fail"));
      const { listProjects } = await import("./server-client.js");
      const result = await listProjects();
      expect(result).toEqual([]);
    });
  });

  describe("stopServer", () => {
    it("returns true on success", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const { stopServer } = await import("./server-client.js");
      const result = await stopServer();
      expect(result).toBe(true);
    });

    it("returns true even on error (server already stopped)", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const { stopServer } = await import("./server-client.js");
      const result = await stopServer();
      expect(result).toBe(true);
    });
  });

  describe("extension notification helpers", () => {
    it("notifyExtensionReload sends POST", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const { notifyExtensionReload } = await import("./server-client.js");
      const result = await notifyExtensionReload("proj-1", "my-ext");
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:42888/api/projects/proj-1/extensions/reload",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("notifyExtensionEnable sends POST to correct URL", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const { notifyExtensionEnable } = await import("./server-client.js");
      const result = await notifyExtensionEnable("proj-1", "my-ext");
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:42888/api/projects/proj-1/extensions/my-ext/enable",
        expect.any(Object),
      );
    });

    it("notifyExtensionDisable sends POST to correct URL", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const { notifyExtensionDisable } = await import("./server-client.js");
      const result = await notifyExtensionDisable("proj-1", "my-ext");
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:42888/api/projects/proj-1/extensions/my-ext/disable",
        expect.any(Object),
      );
    });
  });
});
