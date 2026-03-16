import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";


const mocks = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  globalDir: "/tmp/renre-kit-test-marketplace-" + process.pid,
}));

vi.mock("../core/logger.js", () => ({
  logger: mocks.logger,
}));

vi.mock("../core/paths.js", () => ({
  globalPaths: () => ({
    globalDir: mocks.globalDir,
    extensionsDir: join(mocks.globalDir, "extensions"),
  }),
}));

import {
  fetchLocalMarketplace,
  fetchMarketplace,
  loadCache,
  saveCache,
  isCacheStale,
  searchExtensions,
  refreshCache,
  type MarketplaceCache,
  type MarketplaceConfig,
  type MarketplaceExtension,
} from "./marketplace-client.js";

describe("marketplace-client", () => {
  const testDir = mocks.globalDir;

  beforeEach(() => {
    vi.clearAllMocks();
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // fetchLocalMarketplace
  // -------------------------------------------------------------------------
  describe("fetchLocalMarketplace", () => {
    it("reads marketplace.json from directory path", () => {
      const dir = join(testDir, "local-mp");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "marketplace.json"),
        JSON.stringify({
          extensions: [
            { name: "ext-a", version: "1.0.0", description: "Test A", repository: "", tags: ["test"] },
          ],
        }),
      );

      const result = fetchLocalMarketplace(dir);
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("ext-a");
    });

    it("reads a direct .json file path", () => {
      const file = join(testDir, "custom.json");
      writeFileSync(
        file,
        JSON.stringify({
          extensions: [
            { name: "ext-b", version: "2.0.0", description: "Test B", repository: "", tags: [] },
          ],
        }),
      );

      const result = fetchLocalMarketplace(file);
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("ext-b");
    });

    it("throws when file does not exist", () => {
      expect(() => fetchLocalMarketplace("/nonexistent/path")).toThrow(
        "Local marketplace file not found",
      );
    });

    it("throws when extensions array is missing", () => {
      const file = join(testDir, "bad.json");
      writeFileSync(file, JSON.stringify({ name: "bad" }));

      expect(() => fetchLocalMarketplace(file)).toThrow("missing extensions array");
    });

    it("resolves file:// URIs", () => {
      const dir = join(testDir, "file-uri");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "marketplace.json"),
        JSON.stringify({ extensions: [] }),
      );

      const result = fetchLocalMarketplace(`file://${dir}`);
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // fetchMarketplace (remote)
  // -------------------------------------------------------------------------
  describe("fetchMarketplace", () => {
    it("handles local paths by delegating to fetchLocalMarketplace", async () => {
      const dir = join(testDir, "local-fetch");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "marketplace.json"),
        JSON.stringify({
          extensions: [
            { name: "local-ext", version: "1.0.0", description: "L", repository: "", tags: [] },
          ],
        }),
      );

      const result = await fetchMarketplace(dir);
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("local-ext");
    });

    it("fetches from remote URL", async () => {
      const extensions = [
        { name: "remote-ext", version: "1.0.0", description: "R", repository: "", tags: ["remote"] },
      ];
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ extensions }),
      } as Response);

      const result = await fetchMarketplace("https://example.com/marketplace");
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("remote-ext");
    });

    it("throws on non-ok HTTP response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      await expect(fetchMarketplace("https://example.com/bad")).rejects.toThrow(
        "HTTP 404",
      );
    });

    it("throws on invalid response body", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: "no extensions" }),
      } as Response);

      await expect(fetchMarketplace("https://example.com/bad")).rejects.toThrow(
        "missing extensions array",
      );
    });

    it("builds correct URL for GitHub repos", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ extensions: [] }),
      } as Response);

      await fetchMarketplace("https://github.com/org/repo");
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://github.com/org/repo/raw/main/.renre-kit/marketplace.json",
        expect.anything(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Cache operations
  // -------------------------------------------------------------------------
  describe("loadCache / saveCache", () => {
    it("returns null when no cache file exists", () => {
      expect(loadCache()).toBeNull();
    });

    it("round-trips cache through save and load", () => {
      const cache: MarketplaceCache = {
        marketplaces: [
          {
            name: "default",
            url: "https://example.com",
            extensions: [],
            fetchedAt: new Date().toISOString(),
          },
        ],
        fetchedAt: new Date().toISOString(),
      };

      saveCache(cache);
      const loaded = loadCache();
      expect(loaded).toEqual(cache);
    });

    it("returns null for corrupted cache file", () => {
      writeFileSync(join(testDir, "marketplace-cache.json"), "not json{{{");
      expect(loadCache()).toBeNull();
    });
  });

  describe("isCacheStale", () => {
    it("returns false for fresh cache", () => {
      const cache: MarketplaceCache = {
        marketplaces: [],
        fetchedAt: new Date().toISOString(),
      };
      expect(isCacheStale(cache)).toBe(false);
    });

    it("returns true for cache older than 1 hour", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const cache: MarketplaceCache = {
        marketplaces: [],
        fetchedAt: twoHoursAgo,
      };
      expect(isCacheStale(cache)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // searchExtensions
  // -------------------------------------------------------------------------
  describe("searchExtensions", () => {
    const sampleCache: MarketplaceCache = {
      marketplaces: [
        {
          name: "default",
          url: "https://example.com",
          extensions: [
            { name: "git-helper", version: "1.0.0", description: "Git utilities", repository: "", tags: ["git", "vcs"] },
            { name: "docker-compose", version: "2.0.0", description: "Docker orchestration", repository: "", tags: ["docker", "containers"] },
            { name: "test-runner", version: "1.0.0", description: "Run tests easily", repository: "", tags: ["testing"] },
          ],
          fetchedAt: new Date().toISOString(),
        },
      ],
      fetchedAt: new Date().toISOString(),
    };

    it("returns all extensions for empty query", () => {
      const results = searchExtensions(sampleCache, "");
      expect(results).toHaveLength(3);
      expect(results[0]!.marketplace).toBe("default");
    });

    it("matches by name", () => {
      const results = searchExtensions(sampleCache, "git");
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe("git-helper");
    });

    it("matches by description", () => {
      const results = searchExtensions(sampleCache, "orchestration");
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe("docker-compose");
    });

    it("matches by tag", () => {
      const results = searchExtensions(sampleCache, "testing");
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe("test-runner");
    });

    it("is case-insensitive", () => {
      const results = searchExtensions(sampleCache, "DOCKER");
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe("docker-compose");
    });

    it("returns empty array when nothing matches", () => {
      const results = searchExtensions(sampleCache, "zzz-nonexistent");
      expect(results).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // refreshCache
  // -------------------------------------------------------------------------
  describe("refreshCache", () => {
    it("fetches from all configured marketplaces and saves cache", async () => {
      const extensions: MarketplaceExtension[] = [
        { name: "e1", version: "1.0.0", description: "E1", repository: "", tags: [] },
      ];
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ extensions }),
      } as Response);

      const configs: MarketplaceConfig[] = [
        { name: "mp1", url: "https://example.com/mp1" },
      ];

      const cache = await refreshCache(configs);
      expect(cache.marketplaces).toHaveLength(1);
      expect(cache.marketplaces[0]!.name).toBe("mp1");
      expect(cache.marketplaces[0]!.extensions).toEqual(extensions);

      // Verify cache was saved
      const loaded = loadCache();
      expect(loaded).toEqual(cache);
    });

    it("continues on fetch errors and logs warning", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));

      const configs: MarketplaceConfig[] = [
        { name: "bad-mp", url: "https://bad.example.com" },
      ];

      const cache = await refreshCache(configs);
      expect(cache.marketplaces).toHaveLength(0);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        "marketplace",
        expect.stringContaining("bad-mp"),
      );
    });
  });
});
