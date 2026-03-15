import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger
vi.mock("../core/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock mcp-manager
vi.mock("../core/mcp-manager.js", () => ({
  getStatus: vi.fn().mockReturnValue({
    servers: [],
    totalConnections: 0,
    activeConnections: 0,
  }),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./mcp.js";
import { getStatus } from "../core/mcp-manager.js";

describe("mcp routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp(router);
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/mcp/status
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/mcp/status", () => {
    it("returns MCP status", async () => {
      const res = await request(app, "GET", "/api/proj-1/mcp/status");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["servers"]).toEqual([]);
      expect(body["totalConnections"]).toBe(0);
      expect(body["activeConnections"]).toBe(0);
      expect(getStatus).toHaveBeenCalledWith("proj-1");
    });

    it("returns status with active servers", async () => {
      (getStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        servers: [
          { name: "test-server", transport: "stdio", status: "connected" },
        ],
        totalConnections: 1,
        activeConnections: 1,
      });
      const res = await request(app, "GET", "/api/proj-1/mcp/status");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      const servers = body["servers"] as Array<Record<string, unknown>>;
      expect(servers).toHaveLength(1);
      expect(servers[0]!["name"]).toBe("test-server");
      expect(servers[0]!["status"]).toBe("connected");
    });

    it("calls getStatus with the correct project ID", async () => {
      await request(app, "GET", "/api/my-project/mcp/status");
      expect(getStatus).toHaveBeenCalledWith("my-project");
    });
  });
});
