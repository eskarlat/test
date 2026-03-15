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
vi.mock("../core/db-manager.js", () => ({
  dbManager: {
    getConnection: () => ({
      prepare: vi.fn().mockReturnValue({ run: vi.fn() }),
    }),
  },
}));

// Mock error-intelligence
const samplePattern = {
  fingerprint: "fp-1",
  projectId: "proj-1",
  messageTemplate: "TypeError: cannot read property",
  occurrenceCount: 5,
  sessionCount: 3,
  status: "active",
  resolveNote: null,
  firstSeen: "2025-01-01T00:00:00.000Z",
  lastSeen: "2025-01-02T00:00:00.000Z",
};

vi.mock("../core/error-intelligence.js", () => ({
  listPatterns: vi.fn().mockReturnValue([]),
  resolvePattern: vi.fn().mockReturnValue(true),
  ignorePattern: vi.fn().mockReturnValue(true),
  reactivateIfRecurring: vi.fn(),
  trends: vi.fn().mockReturnValue([]),
  getPatternStats: vi.fn().mockReturnValue({ total: 0, active: 0, resolved: 0, ignored: 0 }),
  listErrors: vi.fn().mockReturnValue([]),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./errors-intelligence.js";
import {
  listPatterns,
  resolvePattern,
  ignorePattern,
  trends,
  getPatternStats,
  listErrors,
} from "../core/error-intelligence.js";

describe("errors-intelligence routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    (listPatterns as ReturnType<typeof vi.fn>).mockReturnValue([]);
    app = createTestApp(router);
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/errors
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/errors", () => {
    it("returns empty array when no patterns", async () => {
      const res = await request(app, "GET", "/api/proj-1/errors");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns mapped patterns", async () => {
      (listPatterns as ReturnType<typeof vi.fn>).mockReturnValue([samplePattern]);
      const res = await request(app, "GET", "/api/proj-1/errors");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]!["id"]).toBe("fp-1");
      expect(body[0]!["fingerprint"]).toBe("fp-1");
      expect(body[0]!["messageTemplate"]).toBe("TypeError: cannot read property");
      expect(body[0]!["occurrenceCount"]).toBe(5);
      expect(body[0]!["status"]).toBe("active");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/errors/trends
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/errors/trends", () => {
    it("returns trend data", async () => {
      (trends as ReturnType<typeof vi.fn>).mockReturnValue([
        { day: "2025-01-01", count: 3 },
        { day: "2025-01-02", count: 7 },
      ]);
      const res = await request(app, "GET", "/api/proj-1/errors/trends");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(2);
      expect(body[0]!["date"]).toBe("2025-01-01");
      expect(body[0]!["count"]).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // PUT /api/:projectId/errors/:id
  // -------------------------------------------------------------------------

  describe("PUT /api/:projectId/errors/:id", () => {
    it("resolves a pattern", async () => {
      const resolved = { ...samplePattern, status: "resolved", resolveNote: "Fixed it" };
      (listPatterns as ReturnType<typeof vi.fn>).mockReturnValue([resolved]);
      const res = await request(app, "PUT", "/api/proj-1/errors/fp-1", {
        status: "resolved",
        resolutionNote: "Fixed it",
      });
      expect(res.status).toBe(200);
      expect(resolvePattern).toHaveBeenCalledWith("fp-1", "Fixed it");
    });

    it("ignores a pattern", async () => {
      const ignored = { ...samplePattern, status: "ignored" };
      (listPatterns as ReturnType<typeof vi.fn>).mockReturnValue([ignored]);
      const res = await request(app, "PUT", "/api/proj-1/errors/fp-1", {
        status: "ignored",
      });
      expect(res.status).toBe(200);
      expect(ignorePattern).toHaveBeenCalledWith("fp-1");
    });

    it("returns 404 for non-existent pattern", async () => {
      (listPatterns as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const res = await request(app, "PUT", "/api/proj-1/errors/fp-bad", {
        status: "resolved",
      });
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/errors/intelligence
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/errors/intelligence", () => {
    it("returns raw error events", async () => {
      (listErrors as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: "err-1", message: "Something broke" },
      ]);
      const res = await request(app, "GET", "/api/proj-1/errors/intelligence");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(listErrors).toHaveBeenCalledWith("proj-1", 50, 0);
    });

    it("passes limit and offset query params", async () => {
      await request(app, "GET", "/api/proj-1/errors/intelligence?limit=10&offset=5");
      expect(listErrors).toHaveBeenCalledWith("proj-1", 10, 5);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/errors/patterns
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/errors/patterns", () => {
    it("returns patterns (alias endpoint)", async () => {
      (listPatterns as ReturnType<typeof vi.fn>).mockReturnValue([samplePattern]);
      const res = await request(app, "GET", "/api/proj-1/errors/patterns");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]!["fingerprint"]).toBe("fp-1");
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/:projectId/errors/patterns/:fingerprint/resolve
  // -------------------------------------------------------------------------

  describe("POST /api/:projectId/errors/patterns/:fingerprint/resolve", () => {
    it("resolves pattern with note", async () => {
      const res = await request(app, "POST", "/api/proj-1/errors/patterns/fp-1/resolve", {
        note: "Fixed the bug",
      });
      expect(res.status).toBe(200);
      expect(resolvePattern).toHaveBeenCalledWith("fp-1", "Fixed the bug");
    });

    it("returns 404 if pattern not found", async () => {
      (resolvePattern as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const res = await request(app, "POST", "/api/proj-1/errors/patterns/bad/resolve", {});
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/:projectId/errors/patterns/:fingerprint/ignore
  // -------------------------------------------------------------------------

  describe("POST /api/:projectId/errors/patterns/:fingerprint/ignore", () => {
    it("ignores a pattern", async () => {
      const res = await request(app, "POST", "/api/proj-1/errors/patterns/fp-1/ignore");
      expect(res.status).toBe(200);
      expect(ignorePattern).toHaveBeenCalledWith("fp-1");
    });

    it("returns 404 if pattern not found", async () => {
      (ignorePattern as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const res = await request(app, "POST", "/api/proj-1/errors/patterns/bad/ignore");
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/errors/patterns/stats
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/errors/patterns/stats", () => {
    it("returns pattern stats", async () => {
      (getPatternStats as ReturnType<typeof vi.fn>).mockReturnValue({
        total: 10,
        active: 5,
        resolved: 3,
        ignored: 2,
      });
      const res = await request(app, "GET", "/api/proj-1/errors/patterns/stats");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["total"]).toBe(10);
      expect(body["active"]).toBe(5);
    });
  });
});
