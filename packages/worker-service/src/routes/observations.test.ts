import { describe, it, expect, beforeEach, vi } from "vitest";

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdateObservation = vi.fn();
const mockDeleteObservation = vi.fn();
const mockGetObservationStats = vi.fn();

vi.mock("../core/observations-service.js", () => ({
  list: (...args: unknown[]) => mockList(...args),
  create: (...args: unknown[]) => mockCreate(...args),
  updateObservation: (...args: unknown[]) => mockUpdateObservation(...args),
  archiveObservation: vi.fn(),
  deleteObservation: (...args: unknown[]) => mockDeleteObservation(...args),
  getObservationStats: (...args: unknown[]) => mockGetObservationStats(...args),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./observations.js";

describe("observations routes", () => {
  let app: ReturnType<typeof createTestApp>;

  const sampleObs = {
    id: "obs-1",
    projectId: "proj-1",
    content: "Test observation",
    source: "user",
    category: "general",
    confidence: 1.0,
    active: true,
    createdAt: "2025-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReturnValue([sampleObs]);
    mockCreate.mockReturnValue(sampleObs);
    mockUpdateObservation.mockReturnValue(sampleObs);
    mockDeleteObservation.mockReturnValue(sampleObs);
    mockGetObservationStats.mockReturnValue({
      total: 5,
      active: 3,
      byCategory: { general: 3, code: 2 },
    });
    app = createTestApp(router);
  });

  describe("GET /api/:projectId/observations", () => {
    it("returns observations list", async () => {
      const res = await request(app, "GET", "/api/proj-1/observations");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body.length).toBe(1);
      expect(body[0]!["id"]).toBe("obs-1");
    });

    it("defaults to active only", async () => {
      await request(app, "GET", "/api/proj-1/observations");
      expect(mockList).toHaveBeenCalledWith("proj-1", true);
    });

    it("passes active=false when specified", async () => {
      await request(app, "GET", "/api/proj-1/observations?active=false");
      expect(mockList).toHaveBeenCalledWith("proj-1", false);
    });
  });

  describe("POST /api/:projectId/observations", () => {
    it("creates observation with valid content", async () => {
      const res = await request(app, "POST", "/api/proj-1/observations", {
        content: "New observation",
      });
      expect(res.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledWith(
        "proj-1",
        "New observation",
        "user",
        "general",
        1.0,
      );
    });

    it("returns 400 when content is missing", async () => {
      const res = await request(app, "POST", "/api/proj-1/observations", {});
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain(
        "content",
      );
    });

    it("returns 409 for duplicate observation", async () => {
      mockCreate.mockReturnValue(null);
      const res = await request(app, "POST", "/api/proj-1/observations", {
        content: "Duplicate",
      });
      expect(res.status).toBe(409);
    });

    it("passes custom source, category, and confidence", async () => {
      await request(app, "POST", "/api/proj-1/observations", {
        content: "My obs",
        source: "hook",
        category: "code",
        confidence: 0.8,
      });
      expect(mockCreate).toHaveBeenCalledWith(
        "proj-1",
        "My obs",
        "hook",
        "code",
        0.8,
      );
    });
  });

  describe("PUT /api/:projectId/observations/:id", () => {
    it("updates observation", async () => {
      const res = await request(app, "PUT", "/api/proj-1/observations/obs-1", {
        content: "Updated",
      });
      expect(res.status).toBe(200);
      expect(mockUpdateObservation).toHaveBeenCalledWith("obs-1", {
        content: "Updated",
      });
    });

    it("returns 404 when observation not found", async () => {
      mockUpdateObservation.mockReturnValue(null);
      const res = await request(
        app,
        "PUT",
        "/api/proj-1/observations/missing",
        { content: "x" },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/:projectId/observations/:id", () => {
    it("deletes observation", async () => {
      const res = await request(
        app,
        "DELETE",
        "/api/proj-1/observations/obs-1",
      );
      expect(res.status).toBe(200);
      expect(mockDeleteObservation).toHaveBeenCalledWith("obs-1");
    });

    it("returns 404 when observation not found", async () => {
      mockDeleteObservation.mockReturnValue(null);
      const res = await request(
        app,
        "DELETE",
        "/api/proj-1/observations/missing",
      );
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/:projectId/observations/stats", () => {
    it("returns observation stats", async () => {
      const res = await request(
        app,
        "GET",
        "/api/proj-1/observations/stats",
      );
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["total"]).toBe(5);
      expect(body["active"]).toBe(3);
    });
  });
});
