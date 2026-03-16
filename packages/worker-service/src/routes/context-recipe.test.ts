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

// Mock context-recipe-engine
vi.mock("../core/context-recipe-engine.js", () => ({
  getRecipe: vi.fn().mockReturnValue({
    providers: [{ providerId: "session-memory", enabled: true, config: {} }],
    tokenBudget: 4000,
  }),
  saveRecipe: vi.fn(),
  resetRecipe: vi.fn(),
  preview: vi.fn().mockResolvedValue({ content: "preview content" }),
  getRegisteredProviders: vi.fn().mockReturnValue([
    { id: "session-memory", name: "Session Memory", description: "Recent session context" },
  ]),
  assemble: vi.fn().mockResolvedValue({
    providers: [{ id: "session-memory", tokens: 500 }],
    content: "assembled",
  }),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./context-recipe.js";
import {
  saveRecipe,
  resetRecipe,
  preview,
  assemble,
} from "../core/context-recipe-engine.js";

describe("context-recipe routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp(router);
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/context-recipes
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/context-recipes", () => {
    it("returns recipe with providers and token estimates", async () => {
      const res = await request(app, "GET", "/api/proj-1/context-recipes");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["tokenBudget"]).toBe(4000);
      const providers = body["providers"] as Array<Record<string, unknown>>;
      expect(providers).toHaveLength(1);
      expect(providers[0]!["id"]).toBe("session-memory");
      expect(providers[0]!["estimatedTokens"]).toBe(500);
    });

    it("falls back to sync response on assembly error", async () => {
      (assemble as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
      const res = await request(app, "GET", "/api/proj-1/context-recipes");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["tokenBudget"]).toBe(4000);
      // Estimated tokens will be 0 (no assembly result)
      const providers = body["providers"] as Array<Record<string, unknown>>;
      expect(providers[0]!["estimatedTokens"]).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // PUT /api/:projectId/context-recipes
  // -------------------------------------------------------------------------

  describe("PUT /api/:projectId/context-recipes", () => {
    it("saves recipe and returns updated config", async () => {
      const res = await request(app, "PUT", "/api/proj-1/context-recipes", {
        providers: [
          { id: "session-memory", name: "Session Memory", description: "", enabled: true, estimatedTokens: 0, config: {} },
        ],
        tokenBudget: 8000,
      });
      expect(res.status).toBe(200);
      expect(saveRecipe).toHaveBeenCalledWith("proj-1", expect.objectContaining({
        tokenBudget: 8000,
      }));
    });

    it("returns 400 when providers is missing", async () => {
      const res = await request(app, "PUT", "/api/proj-1/context-recipes", {
        tokenBudget: 4000,
      });
      expect(res.status).toBe(400);
      const body = res.body as Record<string, unknown>;
      expect(body["error"]).toContain("providers");
    });

    it("returns 400 when providers is not an array", async () => {
      const res = await request(app, "PUT", "/api/proj-1/context-recipes", {
        providers: "not-array",
      });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/context-recipes/preview
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/context-recipes/preview", () => {
    it("returns preview content", async () => {
      const res = await request(app, "GET", "/api/proj-1/context-recipes/preview");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["content"]).toBe("preview content");
    });

    it("returns 500 on preview error", async () => {
      (preview as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("preview failed"));
      const res = await request(app, "GET", "/api/proj-1/context-recipes/preview");
      expect(res.status).toBe(500);
      const body = res.body as Record<string, unknown>;
      expect(body["error"]).toContain("preview failed");
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/:projectId/context-recipes/reset
  // -------------------------------------------------------------------------

  describe("POST /api/:projectId/context-recipes/reset", () => {
    it("resets recipe and returns default config", async () => {
      const res = await request(app, "POST", "/api/proj-1/context-recipes/reset");
      expect(res.status).toBe(200);
      expect(resetRecipe).toHaveBeenCalledWith("proj-1");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/context-recipes/providers
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/context-recipes/providers", () => {
    it("returns registered providers", async () => {
      const res = await request(app, "GET", "/api/proj-1/context-recipes/providers");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]!["id"]).toBe("session-memory");
      expect(body[0]!["name"]).toBe("Session Memory");
    });
  });
});
