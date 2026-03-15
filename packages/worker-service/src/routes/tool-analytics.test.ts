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

// Mock tool-analytics
vi.mock("../core/tool-analytics.js", () => ({
  listUsage: vi.fn().mockReturnValue([]),
  getAnalytics: vi.fn().mockReturnValue({ tools: [], totalCalls: 0 }),
  getSessionAnalytics: vi.fn().mockReturnValue({ tools: [], totalCalls: 0 }),
  getStats: vi.fn().mockReturnValue({ totalCalls: 0, uniqueTools: 0, avgDurationMs: 0 }),
  listWarnings: vi.fn().mockReturnValue([]),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./tool-analytics.js";
import {
  listUsage,
  getAnalytics,
  getSessionAnalytics,
  getStats,
  listWarnings,
} from "../core/tool-analytics.js";

describe("tool-analytics routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp(router);
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/tools/usage
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/tools/usage", () => {
    it("returns usage data with default pagination", async () => {
      const res = await request(app, "GET", "/api/proj-1/tools/usage");
      expect(res.status).toBe(200);
      expect(listUsage).toHaveBeenCalledWith("proj-1", 50, 0);
    });

    it("passes custom limit and offset", async () => {
      await request(app, "GET", "/api/proj-1/tools/usage?limit=10&offset=5");
      expect(listUsage).toHaveBeenCalledWith("proj-1", 10, 5);
    });

    it("returns usage rows", async () => {
      (listUsage as ReturnType<typeof vi.fn>).mockReturnValue([
        { toolName: "read_file", callCount: 10, avgDurationMs: 50 },
      ]);
      const res = await request(app, "GET", "/api/proj-1/tools/usage");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]!["toolName"]).toBe("read_file");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/tools/analytics
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/tools/analytics", () => {
    it("returns analytics", async () => {
      (getAnalytics as ReturnType<typeof vi.fn>).mockReturnValue({
        tools: [{ name: "edit_file", count: 5 }],
        totalCalls: 5,
      });
      const res = await request(app, "GET", "/api/proj-1/tools/analytics");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["totalCalls"]).toBe(5);
      expect(getAnalytics).toHaveBeenCalledWith("proj-1");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/tools/analytics/session/:sessionId
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/tools/analytics/session/:sessionId", () => {
    it("returns session-scoped analytics", async () => {
      (getSessionAnalytics as ReturnType<typeof vi.fn>).mockReturnValue({
        tools: [{ name: "bash", count: 3 }],
        totalCalls: 3,
      });
      const res = await request(app, "GET", "/api/proj-1/tools/analytics/session/s1");
      expect(res.status).toBe(200);
      expect(getSessionAnalytics).toHaveBeenCalledWith("proj-1", "s1");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/tools/stats
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/tools/stats", () => {
    it("returns stats", async () => {
      (getStats as ReturnType<typeof vi.fn>).mockReturnValue({
        totalCalls: 100,
        uniqueTools: 10,
        avgDurationMs: 42,
      });
      const res = await request(app, "GET", "/api/proj-1/tools/stats");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["totalCalls"]).toBe(100);
      expect(body["uniqueTools"]).toBe(10);
      expect(getStats).toHaveBeenCalledWith("proj-1");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/tools/warnings
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/tools/warnings", () => {
    it("returns warnings with default limit", async () => {
      const res = await request(app, "GET", "/api/proj-1/tools/warnings");
      expect(res.status).toBe(200);
      expect(listWarnings).toHaveBeenCalledWith("proj-1", 50);
    });

    it("passes custom limit", async () => {
      await request(app, "GET", "/api/proj-1/tools/warnings?limit=25");
      expect(listWarnings).toHaveBeenCalledWith("proj-1", 25);
    });

    it("returns warning list", async () => {
      (listWarnings as ReturnType<typeof vi.fn>).mockReturnValue([
        { toolName: "bash", message: "High error rate", severity: "warning" },
      ]);
      const res = await request(app, "GET", "/api/proj-1/tools/warnings");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]!["toolName"]).toBe("bash");
    });
  });
});
