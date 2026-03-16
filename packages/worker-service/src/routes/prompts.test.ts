import { describe, it, expect, beforeEach, vi } from "vitest";

const mockList = vi.fn();
const mockAnalytics = vi.fn();
const mockSearch = vi.fn();

vi.mock("../core/prompt-journal.js", () => ({
  list: (...args: unknown[]) => mockList(...args),
  analytics: (...args: unknown[]) => mockAnalytics(...args),
  search: (...args: unknown[]) => mockSearch(...args),
}));

const mockPrepare = vi.fn();
vi.mock("../core/db-manager.js", () => ({
  dbManager: {
    getConnection: () => ({
      prepare: mockPrepare,
    }),
  },
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./prompts.js";

describe("prompts routes", () => {
  let app: ReturnType<typeof createTestApp>;

  const samplePrompt = {
    id: "pr-1",
    projectId: "proj-1",
    sessionId: "sess-1",
    agent: "copilot",
    intentCategory: "code-generation",
    promptPreview: "Write a function that sorts an array",
    createdAt: "2025-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReturnValue([samplePrompt]);
    mockSearch.mockReturnValue([samplePrompt]);
    mockAnalytics.mockReturnValue({
      total: 10,
      byCategory: { "code-generation": 5, debugging: 3, explanation: 2 },
    });
    mockPrepare.mockReturnValue({
      all: vi.fn().mockReturnValue([
        { agent: "copilot", cnt: 7 },
        { agent: "claude", cnt: 3 },
      ]),
    });
    app = createTestApp(router);
  });

  describe("GET /api/:projectId/prompts", () => {
    it("returns prompts list", async () => {
      const res = await request(app, "GET", "/api/proj-1/prompts");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body.length).toBe(1);
      expect(body[0]!["id"]).toBe("pr-1");
      expect(body[0]!["intent"]).toBe("code-generation");
    });

    it("uses default limit and offset", async () => {
      await request(app, "GET", "/api/proj-1/prompts");
      expect(mockList).toHaveBeenCalledWith("proj-1", 50, 0);
    });

    it("passes custom limit and offset", async () => {
      await request(app, "GET", "/api/proj-1/prompts?limit=10&offset=5");
      expect(mockList).toHaveBeenCalledWith("proj-1", 10, 5);
    });

    it("uses search when q parameter is provided", async () => {
      const res = await request(app, "GET", "/api/proj-1/prompts?q=sort");
      expect(res.status).toBe(200);
      expect(mockSearch).toHaveBeenCalledWith("proj-1", "sort");
      expect(mockList).not.toHaveBeenCalled();
    });

    it("includes tokenCount in response", async () => {
      const res = await request(app, "GET", "/api/proj-1/prompts");
      const body = res.body as Array<Record<string, unknown>>;
      expect(body[0]!["tokenCount"]).toBeTypeOf("number");
    });
  });

  describe("GET /api/:projectId/prompts/analytics", () => {
    it("returns analytics data", async () => {
      const res = await request(app, "GET", "/api/proj-1/prompts/analytics");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["total"]).toBe(10);
      expect(body["byCategory"]).toBeDefined();
    });
  });

  describe("GET /api/:projectId/prompts/stats", () => {
    it("returns stats with byAgent breakdown", async () => {
      const res = await request(app, "GET", "/api/proj-1/prompts/stats");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["total"]).toBe(10);
      expect(body["byIntent"]).toBeDefined();
      expect(body["byAgent"]).toBeDefined();
      const byAgent = body["byAgent"] as Record<string, number>;
      expect(byAgent["copilot"]).toBe(7);
    });

    it("returns empty byAgent when DB query fails", async () => {
      mockPrepare.mockImplementation(() => {
        throw new Error("db error");
      });
      const res = await request(app, "GET", "/api/proj-1/prompts/stats");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["byAgent"]).toEqual({});
    });
  });
});
