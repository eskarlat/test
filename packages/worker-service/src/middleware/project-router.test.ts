import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createTestApp, request } from "../test-helpers.js";

// Mock logger
vi.mock("../core/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock project registry
const mockProjectRegistry = new Map<string, { id: string; name: string; path: string }>();
vi.mock("../routes/projects.js", () => ({
  getRegistry: () => mockProjectRegistry,
}));

// Mock circuit breaker
const mockIsSuspended = vi.fn().mockReturnValue(false);
const mockRetryAfterMs = vi.fn().mockReturnValue(0);
const mockRecordError = vi.fn();
const mockRecordSuccess = vi.fn();
vi.mock("../core/extension-circuit-breaker.js", () => ({
  circuitBreaker: {
    isSuspended: (...args: unknown[]) => mockIsSuspended(...args),
    retryAfterMs: (...args: unknown[]) => mockRetryAfterMs(...args),
    recordError: (...args: unknown[]) => mockRecordError(...args),
    recordSuccess: (...args: unknown[]) => mockRecordSuccess(...args),
  },
}));

// Mock extension registry
const mockGetRouter = vi.fn().mockReturnValue(null);
vi.mock("../core/extension-registry.js", () => ({
  getRouter: (...args: unknown[]) => mockGetRouter(...args),
}));

// Mock extension-timeout to pass through
vi.mock("./extension-timeout.js", () => ({
  extensionTimeout: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { projectRouterMiddleware } from "./project-router.js";

describe("project-router middleware", () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectRegistry.clear();
    mockIsSuspended.mockReturnValue(false);
    mockRetryAfterMs.mockReturnValue(0);
    mockGetRouter.mockReturnValue(null);
    app = express();
    app.use(express.json());
    app.use(projectRouterMiddleware);
    // Fallthrough handler for non-extension routes
    app.get("/api/projects", (_req, res) => res.json({ ok: true }));
    app.get("/api/health", (_req, res) => res.json({ ok: true }));
  });

  it("passes through non-matching paths", async () => {
    const res = await request(app, "GET", "/api/health");
    expect(res.status).toBe(200);
  });

  it("passes through core paths (projects, vault, etc.)", async () => {
    const res = await request(app, "GET", "/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns 404 when project is not registered", async () => {
    const res = await request(app, "GET", "/api/unknown-proj/my-ext/items");
    expect(res.status).toBe(404);
    const body = res.body as Record<string, unknown>;
    expect(body["error"]).toBe("Project not found");
  });

  it("returns 503 when extension is suspended", async () => {
    mockProjectRegistry.set("proj-1", { id: "proj-1", name: "Test", path: "/tmp" });
    mockIsSuspended.mockReturnValue(true);
    mockRetryAfterMs.mockReturnValue(30000);

    const res = await request(app, "GET", "/api/proj-1/my-ext/items");
    expect(res.status).toBe(503);
    const body = res.body as Record<string, unknown>;
    expect(body["error"]).toBe("Extension suspended");
  });

  it("returns 404 when extension router not found", async () => {
    mockProjectRegistry.set("proj-1", { id: "proj-1", name: "Test", path: "/tmp" });
    mockGetRouter.mockReturnValue(null);

    const res = await request(app, "GET", "/api/proj-1/my-ext/items");
    expect(res.status).toBe(404);
    const body = res.body as Record<string, unknown>;
    expect(body["error"]).toContain("not mounted");
  });

  it("delegates to extension router and records success", async () => {
    mockProjectRegistry.set("proj-1", { id: "proj-1", name: "Test", path: "/tmp" });

    const extRouter = express.Router();
    extRouter.get("/items", (_req, res) => res.json({ items: ["a", "b"] }));
    mockGetRouter.mockReturnValue(extRouter);

    const res = await request(app, "GET", "/api/proj-1/my-ext/items");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: ["a", "b"] });
  });

  it("records error when extension router throws", async () => {
    mockProjectRegistry.set("proj-1", { id: "proj-1", name: "Test", path: "/tmp" });

    const extRouter = express.Router();
    extRouter.get("/items", () => {
      throw new Error("Extension crashed");
    });
    mockGetRouter.mockReturnValue(extRouter);

    const res = await request(app, "GET", "/api/proj-1/my-ext/items");
    expect(res.status).toBe(500);
    const body = res.body as Record<string, unknown>;
    expect(body["error"]).toBe("Internal extension error");
    expect(mockRecordError).toHaveBeenCalledWith("proj-1", "my-ext");
  });
});
