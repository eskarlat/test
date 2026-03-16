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

// Mock subagent-tracking
vi.mock("../core/subagent-tracking.js", () => ({
  list: vi.fn().mockReturnValue([]),
  getTree: vi.fn().mockReturnValue({ root: null, children: [] }),
  analytics: vi.fn().mockReturnValue({ totalSpawned: 0, avgDurationMs: 0 }),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./subagents.js";
import { list, getTree, analytics } from "../core/subagent-tracking.js";

describe("subagents routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp(router);
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/subagents
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/subagents", () => {
    it("returns empty list by default", async () => {
      const res = await request(app, "GET", "/api/proj-1/subagents");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(list).toHaveBeenCalledWith("proj-1", 50);
    });

    it("passes custom limit", async () => {
      await request(app, "GET", "/api/proj-1/subagents?limit=10");
      expect(list).toHaveBeenCalledWith("proj-1", 10);
    });

    it("returns subagent events", async () => {
      (list as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: "sa-1", agentType: "task", status: "completed" },
        { id: "sa-2", agentType: "research", status: "running" },
      ]);
      const res = await request(app, "GET", "/api/proj-1/subagents");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(2);
      expect(body[0]!["id"]).toBe("sa-1");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/subagents/tree/:sessionId
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/subagents/tree/:sessionId", () => {
    it("returns tree for session", async () => {
      (getTree as ReturnType<typeof vi.fn>).mockReturnValue({
        root: { id: "main", type: "main" },
        children: [{ id: "sa-1", type: "task" }],
      });
      const res = await request(app, "GET", "/api/proj-1/subagents/tree/s1");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["root"]).toBeDefined();
      expect(getTree).toHaveBeenCalledWith("proj-1", "s1");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/subagents/analytics
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/subagents/analytics", () => {
    it("returns analytics data", async () => {
      (analytics as ReturnType<typeof vi.fn>).mockReturnValue({
        totalSpawned: 15,
        avgDurationMs: 2500,
      });
      const res = await request(app, "GET", "/api/proj-1/subagents/analytics");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["totalSpawned"]).toBe(15);
      expect(body["avgDurationMs"]).toBe(2500);
      expect(analytics).toHaveBeenCalledWith("proj-1");
    });
  });
});
