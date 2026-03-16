import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  SourceResolver,
  ParsedSource,
  ResolvedExtension,
  MarketplaceConfig,
  MarketplaceEntry,
} from "../types.js";
import { parseSourceUri } from "../parse.js";
import { GitResolver } from "./git.js";

/**
 * Cached marketplace data stored on disk.
 */
interface MarketplaceCache {
  marketplaces: Array<{
    name: string;
    url: string;
    extensions: MarketplaceEntry[];
    fetchedAt: string;
  }>;
  fetchedAt: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resolves extensions from registered marketplace repositories.
 *
 * Marketplace repos are cloned via git (not HTTP fetch) to support
 * private repos that are accessible through git credentials.
 */
export class MarketplaceResolver implements SourceResolver {
  readonly scheme = "marketplace" as const;

  private gitResolver = new GitResolver();
  private cacheDir: string;

  constructor(private marketplaces: MarketplaceConfig[], cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  async resolve(parsed: ParsedSource): Promise<ResolvedExtension> {
    const cache = await this.getOrRefreshCache();
    const match = this.findExtension(cache, parsed);

    if (!match) {
      throw new Error(
        `Extension "${parsed.name}" not found in any marketplace`,
      );
    }

    // Parse the extension's source URI and delegate to appropriate resolver
    const extensionParsed = parseSourceUri(match.extension.source);

    // Override name and ref if the marketplace entry specifies them
    extensionParsed.name = match.extension.name;
    if (parsed.ref !== "latest") {
      extensionParsed.ref = parsed.ref;
    }

    return this.gitResolver.resolve(extensionParsed);
  }

  async download(resolved: ResolvedExtension, destDir: string): Promise<string> {
    return this.gitResolver.download(resolved, destDir);
  }

  /**
   * Get or refresh the marketplace cache.
   */
  async getOrRefreshCache(): Promise<MarketplaceCache> {
    const existing = this.loadCache();
    if (existing && !this.isCacheStale(existing)) {
      return existing;
    }
    return this.refreshCache();
  }

  private findExtension(
    cache: MarketplaceCache,
    parsed: ParsedSource,
  ): { marketplace: string; extension: MarketplaceEntry } | null {
    for (const mp of cache.marketplaces) {
      // Filter by marketplace name if specified
      if (parsed.marketplace && parsed.marketplace !== "*" && mp.name !== parsed.marketplace) {
        continue;
      }

      const ext = mp.extensions.find((e) => e.name === parsed.name);
      if (ext) {
        return { marketplace: mp.name, extension: ext };
      }
    }
    return null;
  }

  private loadCache(): MarketplaceCache | null {
    const file = this.cacheFilePath();
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as MarketplaceCache;
    } catch {
      return null;
    }
  }

  private saveCache(cache: MarketplaceCache): void {
    const file = this.cacheFilePath();
    mkdirSync(this.cacheDir, { recursive: true });
    writeFileSync(file, JSON.stringify(cache, null, 2) + "\n", "utf8");
  }

  private isCacheStale(cache: MarketplaceCache): boolean {
    const fetchedAt = new Date(cache.fetchedAt).getTime();
    return Date.now() - fetchedAt > CACHE_TTL_MS;
  }

  private cacheFilePath(): string {
    return join(this.cacheDir, "marketplace-cache.json");
  }

  /**
   * Refresh the marketplace cache by cloning marketplace repos via git.
   */
  private async refreshCache(): Promise<MarketplaceCache> {
    const now = new Date().toISOString();
    const marketplaces: MarketplaceCache["marketplaces"] = [];

    for (const mp of this.marketplaces) {
      try {
        const extensions = this.fetchMarketplaceIndex(mp.url);
        marketplaces.push({ name: mp.name, url: mp.url, extensions, fetchedAt: now });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[source-resolver] Failed to fetch marketplace "${mp.name}" (${mp.url}): ${message}`);
      }
    }

    const cache: MarketplaceCache = { marketplaces, fetchedAt: now };
    this.saveCache(cache);
    return cache;
  }

  /**
   * Fetch a marketplace index by cloning the repo and reading marketplace.json.
   * Supports both git URLs and local filesystem paths.
   */
  private fetchMarketplaceIndex(url: string): MarketplaceEntry[] {
    // Local marketplace
    if (this.isLocalPath(url)) {
      return this.readLocalMarketplace(url);
    }

    // Git-based marketplace — clone to temp and read
    const tempDir = mkdtempSync(join(tmpdir(), "renre-kit-mp-"));
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      const result = spawnSync(
        "git",
        ["clone", "--depth=1", url, tempDir],
        { stdio: "pipe", encoding: "utf8", timeout: 60_000 },
      );

      if (result.status !== 0) {
        throw new Error(`Failed to clone marketplace repo: ${url}`);
      }

      return this.readMarketplaceJson(tempDir);
    } finally {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Non-fatal cleanup
      }
    }
  }

  private readLocalMarketplace(localPath: string): MarketplaceEntry[] {
    const resolved = localPath.startsWith("file://") ? localPath.slice(7) : localPath;
    return this.readMarketplaceJson(resolved);
  }

  private readMarketplaceJson(dir: string): MarketplaceEntry[] {
    // Try .renre-kit/marketplace.json first, then marketplace.json at root
    const paths = [
      join(dir, ".renre-kit", "marketplace.json"),
      join(dir, "marketplace.json"),
    ];

    for (const filePath of paths) {
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, "utf8")) as {
          extensions?: MarketplaceEntry[];
        };
        if (Array.isArray(data.extensions)) {
          return data.extensions;
        }
      }
    }

    throw new Error(`marketplace.json not found in ${dir}`);
  }

  private isLocalPath(value: string): boolean {
    if (value.startsWith("file://")) return true;
    if (value.startsWith("/") || value.startsWith("~")) return true;
    if (/^[A-Za-z]:[/\\]/.test(value)) return true;
    return false;
  }
}
