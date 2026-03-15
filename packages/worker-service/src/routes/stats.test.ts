import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetStats = vi.fn();

vi.mock("../middleware/request-tracker.js", () => ({
  getStats: (...args: unknown[]) => mockGetStats(...args),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./stats.js";

describe("stats routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStats.mockReturnValue({
      totalRequests: 42,
      avgResponseTime: 15.3,
      errorRate: 0.02,
    });
    app = createTestApp(router);
  });

  describe("GET /api/:projectId/stats/api", () => {
    it("returns stats for the given project", async () => {
      const res = await request(app, "GET", "/api/proj-1/stats/api");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["totalRequests"]).toBe(42);
      expect(mockGetStats).toHaveBeenCalledWith("proj-1");
    });

    it("passes correct projectId to getStats", async () => {
      await request(app, "GET", "/api/my-project/stats/api");
      expect(mockGetStats).toHaveBeenCalledWith("my-project");
    });
  });
});
