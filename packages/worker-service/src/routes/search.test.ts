import { describe, it, expect, beforeEach, vi } from "vitest";

const mockSearchAll = vi.fn();

vi.mock("../core/fts-search-service.js", () => ({
  searchAll: (...args: unknown[]) => mockSearchAll(...args),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./search.js";

describe("search routes", () => {
  let app: ReturnType<typeof createTestApp>;

  const sampleResults = [
    { table: "prompts", id: "p1", snippet: "test prompt", rank: 1.0 },
    {
      table: "observations",
      id: "o1",
      snippet: "test observation",
      rank: 0.8,
    },
    { table: "errors", id: "e1", snippet: "test error", rank: 0.5 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchAll.mockReturnValue(sampleResults);
    app = createTestApp(router);
  });

  describe("GET /api/:projectId/search", () => {
    it("returns 400 when q is missing", async () => {
      const res = await request(app, "GET", "/api/proj-1/search");
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain(
        "q is required",
      );
    });

    it("returns 400 when q is empty", async () => {
      const res = await request(app, "GET", "/api/proj-1/search?q=");
      expect(res.status).toBe(400);
    });

    it("returns search results for valid query", async () => {
      const res = await request(app, "GET", "/api/proj-1/search?q=test");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["query"]).toBe("test");
      expect((body["results"] as unknown[]).length).toBe(3);
      expect(mockSearchAll).toHaveBeenCalledWith("proj-1", "test", 20);
    });

    it("passes limit parameter to searchAll", async () => {
      await request(app, "GET", "/api/proj-1/search?q=test&limit=5");
      expect(mockSearchAll).toHaveBeenCalledWith("proj-1", "test", 5);
    });

    it("filters by table when tables parameter is provided", async () => {
      const res = await request(
        app,
        "GET",
        "/api/proj-1/search?q=test&tables=prompts",
      );
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      const results = body["results"] as Array<Record<string, unknown>>;
      expect(results.every((r) => r["table"] === "prompts")).toBe(true);
    });

    it("filters by multiple tables", async () => {
      const res = await request(
        app,
        "GET",
        "/api/proj-1/search?q=test&tables=prompts,errors",
      );
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      const results = body["results"] as Array<Record<string, unknown>>;
      expect(
        results.every(
          (r) => r["table"] === "prompts" || r["table"] === "errors",
        ),
      ).toBe(true);
    });

    it("ignores invalid table names in filter", async () => {
      const res = await request(
        app,
        "GET",
        "/api/proj-1/search?q=test&tables=invalid",
      );
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      // No valid tables means no filtering, return all
      expect((body["results"] as unknown[]).length).toBe(3);
    });
  });
});
