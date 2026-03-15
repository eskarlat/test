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

// Mock db-manager
const mockAll = vi.fn().mockReturnValue([]);
const mockGet = vi.fn().mockReturnValue(undefined);
const mockPrepare = vi.fn().mockReturnValue({ all: mockAll, get: mockGet });

vi.mock("../core/db-manager.js", () => ({
  dbManager: {
    getConnection: () => ({ prepare: mockPrepare }),
  },
}));

// Mock context-monitor
vi.mock("../core/context-monitor.js", () => ({
  getUsage: vi.fn().mockReturnValue({ tokens: 100, limit: 4000 }),
}));

// Mock context-recipe-engine
vi.mock("../core/context-recipe-engine.js", () => ({
  assemble: vi.fn().mockResolvedValue({ providers: [], content: "" }),
}));

// Mock session-memory
vi.mock("../core/session-memory.js", () => ({
  getSessionCheckpoints: vi.fn().mockReturnValue([]),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./sessions.js";
import { getUsage } from "../core/context-monitor.js";
import { assemble } from "../core/context-recipe-engine.js";
import { getSessionCheckpoints } from "../core/session-memory.js";

describe("sessions routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockReturnValue([]);
    mockGet.mockReturnValue(undefined);
    mockPrepare.mockReturnValue({ all: mockAll, get: mockGet });
    app = createTestApp(router);
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/sessions
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/sessions", () => {
    it("returns empty array when no sessions exist", async () => {
      const res = await request(app, "GET", "/api/proj-1/sessions");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns mapped session rows", async () => {
      mockAll.mockReturnValue([
        {
          id: "s1",
          project_id: "proj-1",
          agent: "claude-code",
          status: "active",
          started_at: "2025-01-01T00:00:00.000Z",
          ended_at: null,
          summary: null,
          prompt_count: 5,
          tool_count: 3,
          error_count: 0,
          files_modified: "[]",
          archived: 0,
          source: null,
        },
      ]);
      const res = await request(app, "GET", "/api/proj-1/sessions");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]!["id"]).toBe("s1");
      expect(body[0]!["agent"]).toBe("claude-code");
      expect(body[0]!["promptCount"]).toBe(5);
    });

    it("returns empty array on DB error", async () => {
      mockPrepare.mockImplementationOnce(() => {
        throw new Error("DB error");
      });
      const res = await request(app, "GET", "/api/proj-1/sessions");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/sessions/stats
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/sessions/stats", () => {
    it("returns stats", async () => {
      mockGet
        .mockReturnValueOnce({ cnt: 10 })
        .mockReturnValueOnce({ cnt: 2 })
        .mockReturnValueOnce({ avg: 5000 });
      const res = await request(app, "GET", "/api/proj-1/sessions/stats");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["count"]).toBe(10);
      expect(body["activeCount"]).toBe(2);
      expect(body["avgDurationMs"]).toBe(5000);
    });

    it("returns zero stats on DB error", async () => {
      mockPrepare.mockImplementationOnce(() => {
        throw new Error("DB error");
      });
      const res = await request(app, "GET", "/api/proj-1/sessions/stats");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["count"]).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/sessions/context-preview
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/sessions/context-preview", () => {
    it("returns assembled context", async () => {
      (assemble as ReturnType<typeof vi.fn>).mockResolvedValue({
        providers: [],
        content: "hello",
      });
      const res = await request(app, "GET", "/api/proj-1/sessions/context-preview");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["content"]).toBe("hello");
    });

    it("returns 500 on assembly error", async () => {
      (assemble as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
      const res = await request(app, "GET", "/api/proj-1/sessions/context-preview");
      expect(res.status).toBe(500);
      const body = res.body as Record<string, unknown>;
      expect(body["error"]).toContain("fail");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/sessions/:id/context-usage
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/sessions/:id/context-usage", () => {
    it("returns usage data", async () => {
      const res = await request(app, "GET", "/api/proj-1/sessions/s1/context-usage");
      expect(res.status).toBe(200);
      expect(getUsage).toHaveBeenCalledWith("s1", "claude-code");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/sessions/:id
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/sessions/:id", () => {
    it("returns session detail", async () => {
      mockGet.mockReturnValue({
        id: "s1",
        project_id: "proj-1",
        agent: "claude-code",
        status: "ended",
        started_at: "2025-01-01T00:00:00.000Z",
        ended_at: "2025-01-01T01:00:00.000Z",
        summary: "Test session",
        prompt_count: 5,
        tool_count: 3,
        error_count: 0,
      });
      const res = await request(app, "GET", "/api/proj-1/sessions/s1");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["id"]).toBe("s1");
      expect(body["summary"]).toBe("Test session");
    });

    it("returns 404 for missing session", async () => {
      mockGet.mockReturnValue(undefined);
      const res = await request(app, "GET", "/api/proj-1/sessions/not-found");
      expect(res.status).toBe(404);
    });

    it("returns 404 on DB error", async () => {
      mockPrepare.mockImplementationOnce(() => {
        throw new Error("DB error");
      });
      const res = await request(app, "GET", "/api/proj-1/sessions/s1");
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/sessions/:id/checkpoints
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/sessions/:id/checkpoints", () => {
    it("returns checkpoints", async () => {
      (getSessionCheckpoints as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: "cp1", label: "Start" },
      ]);
      const res = await request(app, "GET", "/api/proj-1/sessions/s1/checkpoints");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]!["id"]).toBe("cp1");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/sessions/:id/timeline
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/sessions/:id/timeline", () => {
    it("returns empty timeline when tables throw", async () => {
      mockPrepare.mockImplementation(() => {
        throw new Error("no such table");
      });
      const res = await request(app, "GET", "/api/proj-1/sessions/s1/timeline");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["items"]).toEqual([]);
      // Restore default mock for subsequent tests
      mockPrepare.mockReturnValue({ all: mockAll, get: mockGet });
    });

    it("returns timeline items sorted by createdAt desc", async () => {
      // Each prepare() call returns a new object with its own `all` mock
      const callResults = [
        [{ id: "p1", created_at: "2025-01-01T00:00:00.000Z", prompt_preview: "hello", intent_category: "code", agent: null }],
        [{ id: "t1", created_at: "2025-01-01T00:01:00.000Z", tool_name: "read", success: 1, duration_ms: 50 }],
        [],
        [],
        [],
        [],
      ];
      let callIndex = 0;
      mockPrepare.mockImplementation(() => ({
        all: vi.fn().mockReturnValue(callResults[callIndex++] ?? []),
        get: mockGet,
      }));

      const res = await request(app, "GET", "/api/proj-1/sessions/s1/timeline");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      const items = body["items"] as Array<Record<string, unknown>>;
      expect(items).toHaveLength(2);
      // Sorted desc: tool (00:01) first, then prompt (00:00)
      expect(items[0]!["type"]).toBe("tool");
      expect(items[1]!["type"]).toBe("prompt");
      // Restore default mock
      mockPrepare.mockReturnValue({ all: mockAll, get: mockGet });
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/sessions/:id/summary
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/sessions/:id/summary", () => {
    it("returns session summary", async () => {
      mockGet.mockReturnValue({
        id: "s1",
        project_id: "proj-1",
        agent: "claude-code",
        status: "ended",
        started_at: "2025-01-01T00:00:00.000Z",
        ended_at: "2025-01-01T01:00:00.000Z",
        summary: "Summary text",
        prompt_count: 5,
        tool_count: 3,
        error_count: 1,
        files_modified: '["src/index.ts"]',
      });
      const res = await request(app, "GET", "/api/proj-1/sessions/s1/summary");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["id"]).toBe("s1");
      expect(body["filesModified"]).toEqual(["src/index.ts"]);
      expect(body["durationMs"]).toBe(3600000);
    });

    it("returns 404 for missing session", async () => {
      mockGet.mockReturnValue(undefined);
      const res = await request(app, "GET", "/api/proj-1/sessions/not-found/summary");
      expect(res.status).toBe(404);
    });
  });
});
