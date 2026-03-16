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

// Mock event-bus
vi.mock("../core/event-bus.js", () => ({
  eventBus: {
    publish: vi.fn(),
  },
}));

const mockListMounted = vi.fn();
const mockMountExtension = vi.fn();
const mockRemountExtension = vi.fn();
const mockUnmountExtension = vi.fn();

vi.mock("../core/extension-registry.js", () => ({
  listMounted: (...args: unknown[]) => mockListMounted(...args),
  mountExtension: (...args: unknown[]) => mockMountExtension(...args),
  remountExtension: (...args: unknown[]) => mockRemountExtension(...args),
  unmountExtension: (...args: unknown[]) => mockUnmountExtension(...args),
}));

const mockProjectRegistry = new Map<string, { path: string; mountedExtensions: Array<{ name: string; version: string }> }>();

vi.mock("./projects.js", () => ({
  getRegistry: () => mockProjectRegistry,
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{"extensions":[]}'),
  writeFileSync: vi.fn(),
}));

import express from "express";
import extensionsRouter from "./extensions.js";
import { createTestApp, request } from "../test-helpers.js";

describe("extensions routes", () => {
  let app: express.Application;

  const sampleExtInfo = {
    name: "my-ext",
    version: "1.0.0",
    status: "mounted",
    routeCount: 2,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectRegistry.clear();
    mockProjectRegistry.set("proj-1", {
      path: "/tmp/proj-1",
      mountedExtensions: [{ name: "my-ext", version: "1.0.0" }],
    });
    mockListMounted.mockReturnValue([sampleExtInfo]);
    mockMountExtension.mockResolvedValue(sampleExtInfo);
    mockRemountExtension.mockResolvedValue(sampleExtInfo);
    mockUnmountExtension.mockResolvedValue(undefined);
    app = createTestApp(extensionsRouter);
  });

  describe("GET /api/:projectId/extensions", () => {
    it("returns mounted extensions list", async () => {
      const res = await request(app, "GET", "/api/proj-1/extensions");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]!["name"]).toBe("my-ext");
    });

    it("returns 404 for unknown project", async () => {
      const res = await request(app, "GET", "/api/unknown-proj/extensions");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/projects/:id/extensions/reload", () => {
    it("reloads a mounted extension", async () => {
      const res = await request(app, "POST", "/api/projects/proj-1/extensions/reload", {
        name: "my-ext",
      });
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["ok"]).toBe(true);
    });

    it("returns 400 when name is missing", async () => {
      const res = await request(app, "POST", "/api/projects/proj-1/extensions/reload", {});
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("name");
    });

    it("returns 404 when extension is not mounted", async () => {
      mockListMounted.mockReturnValue([]);
      const res = await request(app, "POST", "/api/projects/proj-1/extensions/reload", {
        name: "unknown-ext",
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for unknown project", async () => {
      const res = await request(app, "POST", "/api/projects/bad-proj/extensions/reload", {
        name: "my-ext",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/projects/:id/extensions/unload", () => {
    it("unloads a mounted extension", async () => {
      const res = await request(app, "POST", "/api/projects/proj-1/extensions/unload", {
        name: "my-ext",
      });
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["ok"]).toBe(true);
    });

    it("returns 400 when name is missing", async () => {
      const res = await request(app, "POST", "/api/projects/proj-1/extensions/unload", {});
      expect(res.status).toBe(400);
    });

    it("returns 500 on unmount error", async () => {
      mockUnmountExtension.mockRejectedValue(new Error("unmount failed"));
      const res = await request(app, "POST", "/api/projects/proj-1/extensions/unload", {
        name: "my-ext",
      });
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/projects/:id/extensions/upgrade", () => {
    it("upgrades extension to new version", async () => {
      const res = await request(app, "POST", "/api/projects/proj-1/extensions/upgrade", {
        name: "my-ext",
        targetVersion: "2.0.0",
      });
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["ok"]).toBe(true);
    });

    it("returns 400 when name or targetVersion is missing", async () => {
      const res = await request(app, "POST", "/api/projects/proj-1/extensions/upgrade", {
        name: "my-ext",
      });
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("targetVersion");
    });

    it("returns 500 on upgrade error", async () => {
      mockRemountExtension.mockRejectedValue(new Error("upgrade failed"));
      const res = await request(app, "POST", "/api/projects/proj-1/extensions/upgrade", {
        name: "my-ext",
        targetVersion: "2.0.0",
      });
      expect(res.status).toBe(500);
    });
  });
});
