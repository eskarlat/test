import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";

// Mock node:fs with memfs
vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

// Mock paths
vi.mock("../utils/paths.js", () => ({
  globalPaths: vi.fn(() => ({
    globalDir: "/home/user/.renre-kit",
  })),
}));

// Mock shared/urls
vi.mock("../shared/urls.js", () => ({
  buildMarketplaceFetchUrl: vi.fn((url: string) => `${url}/marketplace.json`),
  isLocalPath: vi.fn((url: string) => url.startsWith("/") || url.startsWith("~") || url.startsWith("file://")),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import type { MarketplaceCache, MarketplaceExtension } from "./marketplace-client.js";

describe("marketplace-client", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  const sampleExtensions: MarketplaceExtension[] = [
    {
      name: "ext-a",
      version: "1.0.0",
      description: "Extension A",
      repository: "https://github.com/test/ext-a",
      tags: ["utility", "testing"],
    },
    {
      name: "ext-b",
      version: "2.0.0",
      description: "Extension B for analytics",
      repository: "https://github.com/test/ext-b",
      tags: ["analytics"],
    },
  ];

  describe("fetchLocalMarketplace", () => {
    it("reads marketplace.json from a directory path", async () => {
      vol.mkdirSync("/my-marketplace", { recursive: true });
      vol.writeFileSync(
        "/my-marketplace/marketplace.json",
        JSON.stringify({ extensions: sampleExtensions }),
      );

      const { fetchLocalMarketplace } = await import("./marketplace-client.js");
      const result = fetchLocalMarketplace("/my-marketplace");
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("ext-a");
    });

    it("reads a direct .json file path", async () => {
      vol.mkdirSync("/data", { recursive: true });
      vol.writeFileSync(
        "/data/custom.json",
        JSON.stringify({ extensions: sampleExtensions }),
      );

      const { fetchLocalMarketplace } = await import("./marketplace-client.js");
      const result = fetchLocalMarketplace("/data/custom.json");
      expect(result).toHaveLength(2);
    });

    it("throws if file not found", async () => {
      const { fetchLocalMarketplace } = await import("./marketplace-client.js");
      expect(() => fetchLocalMarketplace("/nonexistent")).toThrow("not found");
    });

    it("throws if extensions array is missing", async () => {
      vol.mkdirSync("/bad", { recursive: true });
      vol.writeFileSync("/bad/marketplace.json", JSON.stringify({ name: "bad" }));

      const { fetchLocalMarketplace } = await import("./marketplace-client.js");
      expect(() => fetchLocalMarketplace("/bad")).toThrow("missing extensions array");
    });
  });

  describe("fetchMarketplace", () => {
    it("fetches from remote URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ extensions: sampleExtensions }),
      });

      const { fetchMarketplace } = await import("./marketplace-client.js");
      const result = await fetchMarketplace("https://example.com/repo");
      expect(result).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/repo/marketplace.json",
        expect.any(Object),
      );
    });

    it("throws on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const { fetchMarketplace } = await import("./marketplace-client.js");
      await expect(fetchMarketplace("https://example.com/repo")).rejects.toThrow("HTTP 404");
    });

    it("throws on invalid response (no extensions array)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ name: "bad" }),
      });

      const { fetchMarketplace } = await import("./marketplace-client.js");
      await expect(fetchMarketplace("https://example.com/repo")).rejects.toThrow(
        "missing extensions array",
      );
    });

    it("delegates to local marketplace for local paths", async () => {
      vol.mkdirSync("/local-mp", { recursive: true });
      vol.writeFileSync(
        "/local-mp/marketplace.json",
        JSON.stringify({ extensions: sampleExtensions }),
      );

      const { fetchMarketplace } = await import("./marketplace-client.js");
      const result = await fetchMarketplace("/local-mp");
      expect(result).toHaveLength(2);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("loadCache / saveCache", () => {
    it("returns null when no cache file exists", async () => {
      const { loadCache } = await import("./marketplace-client.js");
      expect(loadCache()).toBeNull();
    });

    it("saves and loads cache", async () => {
      vol.mkdirSync("/home/user/.renre-kit", { recursive: true });

      const cache: MarketplaceCache = {
        marketplaces: [
          {
            name: "official",
            url: "https://example.com",
            extensions: sampleExtensions,
            fetchedAt: "2026-01-01T00:00:00Z",
          },
        ],
        fetchedAt: "2026-01-01T00:00:00Z",
      };

      const { saveCache, loadCache } = await import("./marketplace-client.js");
      saveCache(cache);
      const loaded = loadCache();
      expect(loaded).not.toBeNull();
      expect(loaded!.marketplaces).toHaveLength(1);
      expect(loaded!.marketplaces[0].extensions).toHaveLength(2);
    });

    it("returns null on corrupt cache file", async () => {
      vol.mkdirSync("/home/user/.renre-kit", { recursive: true });
      vol.writeFileSync("/home/user/.renre-kit/marketplace-cache.json", "not json{{{");

      const { loadCache } = await import("./marketplace-client.js");
      expect(loadCache()).toBeNull();
    });
  });

  describe("isCacheStale", () => {
    it("returns false for recent cache", async () => {
      const { isCacheStale } = await import("./marketplace-client.js");
      const cache: MarketplaceCache = {
        marketplaces: [],
        fetchedAt: new Date().toISOString(),
      };
      expect(isCacheStale(cache)).toBe(false);
    });

    it("returns true for old cache", async () => {
      const { isCacheStale } = await import("./marketplace-client.js");
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const cache: MarketplaceCache = {
        marketplaces: [],
        fetchedAt: twoHoursAgo,
      };
      expect(isCacheStale(cache)).toBe(true);
    });
  });

  describe("refreshCache", () => {
    it("fetches all marketplaces and saves cache", async () => {
      vol.mkdirSync("/home/user/.renre-kit", { recursive: true });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ extensions: sampleExtensions }),
      });

      const { refreshCache } = await import("./marketplace-client.js");
      const cache = await refreshCache([
        { name: "official", url: "https://example.com/repo" },
      ]);

      expect(cache.marketplaces).toHaveLength(1);
      expect(cache.marketplaces[0].name).toBe("official");
      expect(cache.marketplaces[0].extensions).toHaveLength(2);
    });

    it("skips failed marketplaces", async () => {
      vol.mkdirSync("/home/user/.renre-kit", { recursive: true });

      mockFetch.mockRejectedValueOnce(new Error("network error"));

      const { refreshCache } = await import("./marketplace-client.js");
      const cache = await refreshCache([
        { name: "broken", url: "https://broken.example.com" },
      ]);

      expect(cache.marketplaces).toHaveLength(0);
    });
  });

  describe("searchExtensions", () => {
    it("finds extensions by name", async () => {
      const { searchExtensions } = await import("./marketplace-client.js");
      const cache: MarketplaceCache = {
        marketplaces: [
          {
            name: "official",
            url: "https://example.com",
            extensions: sampleExtensions,
            fetchedAt: "2026-01-01T00:00:00Z",
          },
        ],
        fetchedAt: "2026-01-01T00:00:00Z",
      };

      const results = searchExtensions(cache, "ext-a");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("ext-a");
      expect(results[0].marketplace).toBe("official");
    });

    it("finds extensions by description", async () => {
      const { searchExtensions } = await import("./marketplace-client.js");
      const cache: MarketplaceCache = {
        marketplaces: [
          {
            name: "official",
            url: "https://example.com",
            extensions: sampleExtensions,
            fetchedAt: "2026-01-01T00:00:00Z",
          },
        ],
        fetchedAt: "2026-01-01T00:00:00Z",
      };

      const results = searchExtensions(cache, "analytics");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("ext-b");
    });

    it("finds extensions by tag", async () => {
      const { searchExtensions } = await import("./marketplace-client.js");
      const cache: MarketplaceCache = {
        marketplaces: [
          {
            name: "official",
            url: "https://example.com",
            extensions: sampleExtensions,
            fetchedAt: "2026-01-01T00:00:00Z",
          },
        ],
        fetchedAt: "2026-01-01T00:00:00Z",
      };

      const results = searchExtensions(cache, "testing");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("ext-a");
    });

    it("returns all extensions for empty query", async () => {
      const { searchExtensions } = await import("./marketplace-client.js");
      const cache: MarketplaceCache = {
        marketplaces: [
          {
            name: "official",
            url: "https://example.com",
            extensions: sampleExtensions,
            fetchedAt: "2026-01-01T00:00:00Z",
          },
        ],
        fetchedAt: "2026-01-01T00:00:00Z",
      };

      const results = searchExtensions(cache, "");
      expect(results).toHaveLength(2);
    });

    it("is case-insensitive", async () => {
      const { searchExtensions } = await import("./marketplace-client.js");
      const cache: MarketplaceCache = {
        marketplaces: [
          {
            name: "official",
            url: "https://example.com",
            extensions: sampleExtensions,
            fetchedAt: "2026-01-01T00:00:00Z",
          },
        ],
        fetchedAt: "2026-01-01T00:00:00Z",
      };

      const results = searchExtensions(cache, "EXT-A");
      expect(results).toHaveLength(1);
    });
  });

  describe("resolveExtension", () => {
    const cache: MarketplaceCache = {
      marketplaces: [
        {
          name: "official",
          url: "https://example.com",
          extensions: sampleExtensions,
          fetchedAt: "2026-01-01T00:00:00Z",
        },
        {
          name: "community",
          url: "https://community.example.com",
          extensions: [
            {
              name: "ext-c",
              version: "3.0.0",
              description: "Community ext",
              repository: "https://github.com/test/ext-c",
              tags: [],
            },
          ],
          fetchedAt: "2026-01-01T00:00:00Z",
        },
      ],
      fetchedAt: "2026-01-01T00:00:00Z",
    };

    it("resolves by name only", async () => {
      const { resolveExtension } = await import("./marketplace-client.js");
      const result = resolveExtension(cache, "ext-a");
      expect(result).not.toBeNull();
      expect(result!.ext.name).toBe("ext-a");
      expect(result!.marketplaceName).toBe("official");
    });

    it("resolves with marketplace prefix", async () => {
      const { resolveExtension } = await import("./marketplace-client.js");
      const result = resolveExtension(cache, "community/ext-c");
      expect(result).not.toBeNull();
      expect(result!.ext.name).toBe("ext-c");
      expect(result!.marketplaceName).toBe("community");
    });

    it("resolves with version suffix", async () => {
      const { resolveExtension } = await import("./marketplace-client.js");
      const result = resolveExtension(cache, "ext-a@1.0.0");
      expect(result).not.toBeNull();
      expect(result!.ext.version).toBe("1.0.0");
    });

    it("returns null for wrong version", async () => {
      const { resolveExtension } = await import("./marketplace-client.js");
      const result = resolveExtension(cache, "ext-a@9.9.9");
      expect(result).toBeNull();
    });

    it("returns null for unknown extension", async () => {
      const { resolveExtension } = await import("./marketplace-client.js");
      const result = resolveExtension(cache, "nonexistent");
      expect(result).toBeNull();
    });

    it("resolves with marketplace prefix and version", async () => {
      const { resolveExtension } = await import("./marketplace-client.js");
      const result = resolveExtension(cache, "official/ext-b@2.0.0");
      expect(result).not.toBeNull();
      expect(result!.ext.name).toBe("ext-b");
      expect(result!.ext.version).toBe("2.0.0");
    });

    it("returns null when marketplace doesn't match", async () => {
      const { resolveExtension } = await import("./marketplace-client.js");
      const result = resolveExtension(cache, "community/ext-a");
      expect(result).toBeNull();
    });
  });
});
