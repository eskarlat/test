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

// Mock marketplace-client
vi.mock("../services/marketplace-client.js", () => ({
  loadCache: vi.fn().mockReturnValue(null),
  isCacheStale: vi.fn().mockReturnValue(true),
  refreshCache: vi.fn().mockResolvedValue({
    fetchedAt: "2025-01-01T00:00:00.000Z",
    marketplaces: [
      {
        name: "Official",
        url: "https://marketplace.example.com",
        extensions: [
          { name: "ext-a", version: "1.0.0", description: "Extension A", repository: "https://github.com/a", tags: [] },
        ],
      },
    ],
  }),
  searchExtensions: vi.fn().mockReturnValue([]),
}));

// Mock extension-registry
vi.mock("../core/extension-registry.js", () => ({
  mountExtension: vi.fn().mockResolvedValue({ name: "ext-a", status: "mounted" }),
  unmountExtension: vi.fn().mockResolvedValue(undefined),
  remountExtension: vi.fn().mockResolvedValue({ name: "ext-a", status: "mounted" }),
  listMounted: vi.fn().mockReturnValue([]),
}));

// Mock event-bus
vi.mock("../core/event-bus.js", () => ({
  eventBus: { publish: vi.fn() },
}));

// Mock paths
vi.mock("../core/paths.js", () => ({
  globalPaths: () => ({
    configFile: "/tmp/renre-kit/config.json",
    globalDir: "/tmp/renre-kit",
    extensionsDir: "/tmp/renre-kit/extensions",
  }),
}));

// Mock db-manager
vi.mock("../core/db-manager.js", () => ({
  dbManager: {
    getConnection: () => ({
      prepare: vi.fn().mockReturnValue({ run: vi.fn() }),
    }),
  },
}));

// Mock shared/urls
vi.mock("../shared/urls.js", () => ({
  DEFAULT_MARKETPLACE_URL: "https://marketplace.example.com",
}));

// Mock projects registry
const mockProjectRegistry = new Map<string, { path: string }>();

vi.mock("./projects.js", () => ({
  getRegistry: () => mockProjectRegistry,
}));

// Mock fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue("{}"),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
}));

// Mock child_process
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn().mockReturnValue({ status: 0 }),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./marketplace.js";
import {
  loadCache,
  refreshCache,
  searchExtensions,
} from "../services/marketplace-client.js";
import { mountExtension } from "../core/extension-registry.js";
import { existsSync, readFileSync } from "node:fs";

describe("marketplace routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectRegistry.clear();

    // Reset mock implementations that may have been overridden in individual tests
    (loadCache as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (refreshCache as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchedAt: "2025-01-01T00:00:00.000Z",
      marketplaces: [
        {
          name: "Official",
          url: "https://marketplace.example.com",
          extensions: [
            { name: "ext-a", version: "1.0.0", description: "Extension A", repository: "https://github.com/a", tags: [] },
          ],
        },
      ],
    });
    (searchExtensions as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("{}");

    app = createTestApp(router);
  });

  // -------------------------------------------------------------------------
  // GET /api/marketplace
  // -------------------------------------------------------------------------

  describe("GET /api/marketplace", () => {
    it("returns marketplace extensions", async () => {
      const res = await request(app, "GET", "/api/marketplace");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      const extensions = body["extensions"] as Array<Record<string, unknown>>;
      expect(extensions).toHaveLength(1);
      expect(extensions[0]!["name"]).toBe("ext-a");
      expect(extensions[0]!["marketplace"]).toBe("Official");
    });

    it("returns 500 on fetch error", async () => {
      (refreshCache as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
      const res = await request(app, "GET", "/api/marketplace");
      expect(res.status).toBe(500);
      const body = res.body as Record<string, unknown>;
      expect(body["error"]).toContain("Failed to fetch marketplace");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/marketplace/search
  // -------------------------------------------------------------------------

  describe("GET /api/marketplace/search", () => {
    it("searches extensions by query", async () => {
      (searchExtensions as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: "ext-a", description: "Extension A" },
      ]);
      const res = await request(app, "GET", "/api/marketplace/search?q=ext");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["query"]).toBe("ext");
      const extensions = body["extensions"] as Array<Record<string, unknown>>;
      expect(extensions).toHaveLength(1);
    });

    it("handles empty query", async () => {
      (searchExtensions as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const res = await request(app, "GET", "/api/marketplace/search");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["query"]).toBe("");
    });

    it("returns 500 on search error", async () => {
      (refreshCache as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Search failed"));
      const res = await request(app, "GET", "/api/marketplace/search?q=test");
      expect(res.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/:projectId/extensions/install
  // -------------------------------------------------------------------------

  describe("POST /api/:projectId/extensions/install", () => {
    it("returns 404 for unknown project", async () => {
      const res = await request(app, "POST", "/api/proj-1/extensions/install", {
        name: "ext-a",
        version: "1.0.0",
        repository: "https://github.com/a",
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 for missing required fields", async () => {
      mockProjectRegistry.set("proj-1", { path: "/tmp/proj" });
      const res = await request(app, "POST", "/api/proj-1/extensions/install", {
        name: "ext-a",
      });
      expect(res.status).toBe(400);
      const body = res.body as Record<string, unknown>;
      expect(body["error"]).toContain("Missing required fields");
    });

    it("installs extension successfully", async () => {
      mockProjectRegistry.set("proj-1", { path: "/tmp/proj" });
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // readFileSync is called for manifest.json and extensions.json
      // Return appropriate content based on the file being read
      (readFileSync as ReturnType<typeof vi.fn>).mockImplementation((filePath: string) => {
        if (typeof filePath === "string" && filePath.includes("manifest.json")) {
          return JSON.stringify({
            name: "ext-a",
            version: "1.0.0",
            sdkVersion: "1.0.0",
            permissions: {},
          });
        }
        // extensions.json
        return JSON.stringify({ extensions: [] });
      });

      const res = await request(app, "POST", "/api/proj-1/extensions/install", {
        name: "ext-a",
        version: "1.0.0",
        repository: "https://github.com/a",
      });
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["ok"]).toBe(true);
      expect(mountExtension).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/:projectId/extensions/:name
  // -------------------------------------------------------------------------

  describe("DELETE /api/:projectId/extensions/:name", () => {
    it("returns 404 for unknown project", async () => {
      const res = await request(app, "DELETE", "/api/proj-1/extensions/ext-a");
      expect(res.status).toBe(404);
    });

    it("returns 404 for uninstalled extension", async () => {
      mockProjectRegistry.set("proj-1", { path: "/tmp/proj" });
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const res = await request(app, "DELETE", "/api/proj-1/extensions/ext-a");
      expect(res.status).toBe(404);
      const body = res.body as Record<string, unknown>;
      expect(body["error"]).toContain("not installed");
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/:projectId/extensions/:name/upgrade
  // -------------------------------------------------------------------------

  describe("POST /api/:projectId/extensions/:name/upgrade", () => {
    it("returns 404 for unknown project", async () => {
      const res = await request(app, "POST", "/api/proj-1/extensions/ext-a/upgrade", {
        version: "2.0.0",
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 when version is missing", async () => {
      mockProjectRegistry.set("proj-1", { path: "/tmp/proj" });
      const res = await request(app, "POST", "/api/proj-1/extensions/ext-a/upgrade", {});
      expect(res.status).toBe(400);
      const body = res.body as Record<string, unknown>;
      expect(body["error"]).toContain("version");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/marketplace/extensions
  // -------------------------------------------------------------------------

  describe("GET /api/marketplace/extensions", () => {
    it("returns extensions list", async () => {
      const res = await request(app, "GET", "/api/marketplace/extensions");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      const extensions = body["extensions"] as Array<Record<string, unknown>>;
      expect(extensions).toHaveLength(1);
    });

    it("returns 500 on error", async () => {
      (refreshCache as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
      const res = await request(app, "GET", "/api/marketplace/extensions");
      expect(res.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/:projectId/extensions/:name/info
  // -------------------------------------------------------------------------

  describe("GET /api/:projectId/extensions/:name/info", () => {
    it("returns 404 for unknown project", async () => {
      const res = await request(app, "GET", "/api/proj-1/extensions/ext-a/info");
      expect(res.status).toBe(404);
    });

    it("returns 404 for uninstalled extension", async () => {
      mockProjectRegistry.set("proj-1", { path: "/tmp/proj" });
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const res = await request(app, "GET", "/api/proj-1/extensions/ext-a/info");
      expect(res.status).toBe(404);
      const body = res.body as Record<string, unknown>;
      expect(body["error"]).toContain("not installed");
    });
  });
});
