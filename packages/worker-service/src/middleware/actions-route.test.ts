import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createTestApp, request } from "../test-helpers.js";

// Mock extension-registry
const mockGetMountedInfo = vi.fn().mockReturnValue(null);
vi.mock("../core/extension-registry.js", () => ({
  getMountedInfo: (...args: unknown[]) => mockGetMountedInfo(...args),
}));

import { actionsRouteMiddleware } from "./actions-route.js";

describe("actions-route middleware", () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use(actionsRouteMiddleware);
    // Fallthrough for non-matching routes
    app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  });

  it("passes through non-GET requests", async () => {
    const res = await request(app, "POST", "/api/proj-1/my-ext/__actions");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("passes through non-matching paths", async () => {
    const res = await request(app, "GET", "/api/proj-1/my-ext/items");
    expect(res.status).toBe(404);
  });

  it("returns 404 when extension not mounted", async () => {
    mockGetMountedInfo.mockReturnValue(null);
    const res = await request(app, "GET", "/api/proj-1/my-ext/__actions");
    expect(res.status).toBe(404);
    const body = res.body as Record<string, unknown>;
    expect(body["error"]).toContain("not mounted");
  });

  it("returns actions for mounted extension", async () => {
    mockGetMountedInfo.mockReturnValue({
      version: "1.0.0",
      manifest: {
        backend: {
          actions: [
            { name: "list-items", method: "GET", path: "/items" },
            { name: "create-item", method: "POST", path: "/items" },
          ],
        },
      },
    });

    const res = await request(app, "GET", "/api/proj-1/my-ext/__actions");
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body["name"]).toBe("my-ext");
    expect(body["version"]).toBe("1.0.0");
    const actions = body["actions"] as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(2);
    expect(actions[0]!["name"]).toBe("list-items");
  });

  it("returns empty actions when manifest has no backend", async () => {
    mockGetMountedInfo.mockReturnValue({
      version: "1.0.0",
      manifest: {},
    });

    const res = await request(app, "GET", "/api/proj-1/my-ext/__actions");
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body["actions"]).toEqual([]);
  });
});
