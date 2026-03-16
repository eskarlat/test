/**
 * E2E-style integration tests for actions-route, context-provider-route,
 * delegate-to-extension, and parseExtensionRoute.
 *
 * Starts a real Express server, injects mock registries, and hits endpoints
 * with actual HTTP requests.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { Router } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the modules under test
// ---------------------------------------------------------------------------

// Mock logger to prevent noise
vi.mock("../core/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock extension-registry: we control what getMountedInfo and getRouter return
const mockGetMountedInfo = vi.fn();
const mockGetRouter = vi.fn();
vi.mock("../core/extension-registry.js", () => ({
  getMountedInfo: (...args: unknown[]) => mockGetMountedInfo(...args),
  getRouter: (...args: unknown[]) => mockGetRouter(...args),
}));

// Mock projects registry: we control which projects are "registered"
const projectRegistry = new Map<string, unknown>();
vi.mock("../routes/projects.js", () => ({
  getRegistry: () => projectRegistry,
}));

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------
import { actionsRouteMiddleware } from "./actions-route.js";
import { contextProviderRouteMiddleware } from "./context-provider-route.js";
import { parseExtensionRoute } from "./delegate-to-extension.js";

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;

function createTestApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use(actionsRouteMiddleware);
  app.use(contextProviderRouteMiddleware);
  // Fallback so unmatched requests get a 404
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  return app;
}

beforeAll(async () => {
  const app = createTestApp();
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  projectRegistry.clear();
});

// ---------------------------------------------------------------------------
// parseExtensionRoute unit tests
// ---------------------------------------------------------------------------

describe("parseExtensionRoute", () => {
  const pattern = /^\/api\/([^/]+)\/([^/]+)\/__test$/;

  it("parses a valid route", () => {
    const result = parseExtensionRoute("/api/proj-1/my-ext/__test", pattern);
    expect(result).toEqual({ projectId: "proj-1", extensionName: "my-ext" });
  });

  it("returns null for non-matching path", () => {
    expect(parseExtensionRoute("/api/proj-1/my-ext/__other", pattern)).toBeNull();
  });

  it("returns null for path with missing segment", () => {
    expect(parseExtensionRoute("/api/proj-1/__test", pattern)).toBeNull();
  });

  it("returns null for empty path", () => {
    expect(parseExtensionRoute("", pattern)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// __actions endpoint (GET)
// ---------------------------------------------------------------------------

describe("GET /api/{projectId}/{extensionName}/__actions", () => {
  it("returns actions list for a mounted extension", async () => {
    const actions = [
      { name: "search", description: "Search issues", method: "GET", path: "/search" },
      { name: "create", description: "Create issue", method: "POST", path: "/create" },
    ];
    mockGetMountedInfo.mockReturnValue({
      name: "jira",
      version: "1.0.0",
      status: "mounted",
      routeCount: 2,
      manifest: { backend: { actions } },
    });

    const res = await fetch(`${baseUrl}/api/proj-1/jira/__actions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      name: "jira",
      version: "1.0.0",
      actions,
    });
    expect(mockGetMountedInfo).toHaveBeenCalledWith("proj-1", "jira");
  });

  it("returns empty actions when manifest has none", async () => {
    mockGetMountedInfo.mockReturnValue({
      name: "simple-ext",
      version: "0.1.0",
      status: "mounted",
      routeCount: 0,
      manifest: {},
    });

    const res = await fetch(`${baseUrl}/api/proj-2/simple-ext/__actions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.actions).toEqual([]);
  });

  it("returns 404 for unmounted extension", async () => {
    mockGetMountedInfo.mockReturnValue(null);

    const res = await fetch(`${baseUrl}/api/proj-1/missing-ext/__actions`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("missing-ext");
  });

  it("does not match POST requests", async () => {
    const res = await fetch(`${baseUrl}/api/proj-1/ext/__actions`, { method: "POST" });
    // Should fall through to 404 handler since POST doesn't match either middleware for __actions
    expect(res.status).toBe(404);
    expect(mockGetMountedInfo).not.toHaveBeenCalled();
  });

  it("does not match malformed paths", async () => {
    const res = await fetch(`${baseUrl}/api/proj-1/__actions`);
    expect(res.status).toBe(404);
    expect(mockGetMountedInfo).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// __context endpoint (POST)
// ---------------------------------------------------------------------------

describe("POST /api/{projectId}/{extensionName}/__context", () => {
  it("delegates to extension router and returns context response", async () => {
    // Register project
    projectRegistry.set("proj-ctx", { id: "proj-ctx", name: "Test Project" });

    // Set up mounted info with contextProvider
    mockGetMountedInfo.mockReturnValue({
      name: "code-ctx",
      version: "2.0.0",
      status: "mounted",
      routeCount: 1,
      manifest: {
        contextProvider: { entrypoint: "context.js", maxTokens: 4000 },
        backend: { entrypoint: "index.js" },
      },
    });

    // Create a mock extension router that handles /__context
    const extRouter = Router();
    extRouter.post("/__context", (_req, res) => {
      res.json({
        content: "Here is the context data",
        estimatedTokens: 150,
        itemCount: 3,
        truncated: false,
      });
    });
    mockGetRouter.mockReturnValue(extRouter);

    const res = await fetch(`${baseUrl}/api/proj-ctx/code-ctx/__context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      content: "Here is the context data",
      estimatedTokens: 150,
      itemCount: 3,
      truncated: false,
    });
    expect(mockGetMountedInfo).toHaveBeenCalledWith("proj-ctx", "code-ctx");
    expect(mockGetRouter).toHaveBeenCalledWith("proj-ctx", "code-ctx");
  });

  it("returns 404 when project is not registered", async () => {
    // Don't register any project

    const res = await fetch(`${baseUrl}/api/unknown-proj/ext/__context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Project not found");
  });

  it("returns 404 when extension is not mounted", async () => {
    projectRegistry.set("proj-ctx2", { id: "proj-ctx2" });
    mockGetMountedInfo.mockReturnValue(null);

    const res = await fetch(`${baseUrl}/api/proj-ctx2/missing/__context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("missing");
  });

  it("returns 400 when extension has no contextProvider", async () => {
    projectRegistry.set("proj-ctx3", { id: "proj-ctx3" });
    mockGetMountedInfo.mockReturnValue({
      name: "no-ctx",
      version: "1.0.0",
      status: "mounted",
      routeCount: 0,
      manifest: { backend: { entrypoint: "index.js" } },
    });

    const res = await fetch(`${baseUrl}/api/proj-ctx3/no-ctx/__context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("does not declare a contextProvider");
  });

  it("returns 404 when extension router is not available", async () => {
    projectRegistry.set("proj-ctx4", { id: "proj-ctx4" });
    mockGetMountedInfo.mockReturnValue({
      name: "broken-ext",
      version: "1.0.0",
      status: "mounted",
      routeCount: 0,
      manifest: {
        contextProvider: { entrypoint: "context.js" },
      },
    });
    mockGetRouter.mockReturnValue(null);

    const res = await fetch(`${baseUrl}/api/proj-ctx4/broken-ext/__context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("router not available");
  });

  it("does not match GET requests", async () => {
    const res = await fetch(`${baseUrl}/api/proj-1/ext/__context`);
    expect(res.status).toBe(404);
  });

  it("returns 500 when extension router throws", async () => {
    projectRegistry.set("proj-ctx5", { id: "proj-ctx5" });
    mockGetMountedInfo.mockReturnValue({
      name: "crash-ext",
      version: "1.0.0",
      status: "mounted",
      routeCount: 1,
      manifest: {
        contextProvider: { entrypoint: "context.js" },
        backend: { entrypoint: "index.js" },
      },
    });

    // Create a router that throws
    const extRouter = Router();
    extRouter.post("/__context", () => {
      throw new Error("Extension crashed!");
    });
    mockGetRouter.mockReturnValue(extRouter);

    const res = await fetch(`${baseUrl}/api/proj-ctx5/crash-ext/__context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Context provider error");
  });
});

// ---------------------------------------------------------------------------
// delegateToExtensionRouter error isolation
// ---------------------------------------------------------------------------

describe("delegateToExtensionRouter error isolation", () => {
  it("handles async errors passed to next()", async () => {
    projectRegistry.set("proj-err", { id: "proj-err" });
    mockGetMountedInfo.mockReturnValue({
      name: "err-ext",
      version: "1.0.0",
      status: "mounted",
      routeCount: 1,
      manifest: {
        contextProvider: { entrypoint: "context.js" },
        backend: { entrypoint: "index.js" },
      },
    });

    const extRouter = Router();
    extRouter.post("/__context", (_req, _res, next) => {
      next(new Error("Async failure"));
    });
    mockGetRouter.mockReturnValue(extRouter);

    const res = await fetch(`${baseUrl}/api/proj-err/err-ext/__context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Context provider error");
  });
});
