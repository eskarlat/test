import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { globalPaths } from "../core/paths.js";
import { logger } from "../core/logger.js";
import { buildMarketplaceFetchUrl, isLocalPath } from "../shared/urls.js";

export interface MarketplaceExtension {
  name: string;
  version: string;
  description: string;
  repository: string;
  tags: string[];
  author?: string;
  permissions?: Record<string, unknown>;
  settings?: {
    schema: Array<{
      key: string;
      type: string;
      label?: string;
      required?: boolean;
      description?: string;
    }>;
  };
}

export interface MarketplaceConfig {
  name: string;
  url: string;
  /** "url" (default) for remote HTTP marketplaces, "local" for filesystem paths. */
  type?: "url" | "local";
}

export interface MarketplaceIndex {
  name: string;
  url: string;
  extensions: MarketplaceExtension[];
  fetchedAt: string;
}

export interface MarketplaceCache {
  marketplaces: MarketplaceIndex[];
  fetchedAt: string;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

function cacheFilePath(): string {
  return join(globalPaths().globalDir, "marketplace-cache.json");
}

/**
 * Resolve a marketplace source to a local filesystem path.
 * Handles `~/...`, `file://...`, and absolute paths.
 */
function resolveLocalMarketplacePath(source: string): string {
  if (source.startsWith("file://")) {
    return source.slice(7);
  }
  if (source.startsWith("~")) {
    return join(homedir(), source.slice(1));
  }
  return resolve(source);
}

/**
 * Read a marketplace index from a local filesystem path.
 * Looks for `marketplace.json` in the given directory, or reads
 * the path directly if it points to a `.json` file.
 */
export function fetchLocalMarketplace(localPath: string): MarketplaceExtension[] {
  const resolved = resolveLocalMarketplacePath(localPath);
  const filePath = resolved.endsWith(".json")
    ? resolved
    : join(resolved, "marketplace.json");

  if (!existsSync(filePath)) {
    throw new Error(`Local marketplace file not found: ${filePath}`);
  }
  const data = JSON.parse(readFileSync(filePath, "utf8")) as { extensions?: MarketplaceExtension[] };
  if (!Array.isArray(data.extensions)) {
    throw new Error(`Invalid local marketplace at ${filePath}: missing extensions array`);
  }
  return data.extensions;
}

export async function fetchMarketplace(url: string): Promise<MarketplaceExtension[]> {
  // Handle local filesystem marketplaces
  if (isLocalPath(url)) {
    return fetchLocalMarketplace(url);
  }

  const fetchUrl = buildMarketplaceFetchUrl(url);
  const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`Failed to fetch marketplace from ${fetchUrl}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { extensions?: MarketplaceExtension[] };
  if (!Array.isArray(data.extensions)) {
    throw new Error(`Invalid marketplace response from ${fetchUrl}: missing extensions array`);
  }
  return data.extensions;
}

export function loadCache(): MarketplaceCache | null {
  const file = cacheFilePath();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as MarketplaceCache;
  } catch {
    return null;
  }
}

export function saveCache(cache: MarketplaceCache): void {
  const file = cacheFilePath();
  mkdirSync(globalPaths().globalDir, { recursive: true });
  writeFileSync(file, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

export function isCacheStale(cache: MarketplaceCache): boolean {
  const fetchedAt = new Date(cache.fetchedAt).getTime();
  return Date.now() - fetchedAt > ONE_HOUR_MS;
}

export async function refreshCache(marketplaces: MarketplaceConfig[]): Promise<MarketplaceCache> {
  const indices: MarketplaceIndex[] = [];
  const now = new Date().toISOString();

  for (const mp of marketplaces) {
    try {
      const extensions = await fetchMarketplace(mp.url);
      indices.push({ name: mp.name, url: mp.url, extensions, fetchedAt: now });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("marketplace", `Failed to fetch marketplace "${mp.name}": ${msg}`);
    }
  }

  const cache: MarketplaceCache = { marketplaces: indices, fetchedAt: now };
  saveCache(cache);
  return cache;
}

export function searchExtensions(
  cache: MarketplaceCache,
  query: string,
): Array<MarketplaceExtension & { marketplace: string }> {
  const lower = query.toLowerCase();
  const results: Array<MarketplaceExtension & { marketplace: string }> = [];

  for (const index of cache.marketplaces) {
    for (const ext of index.extensions) {
      const matchName = ext.name.toLowerCase().includes(lower);
      const matchDesc = ext.description.toLowerCase().includes(lower);
      const matchTag = ext.tags.some((t) => t.toLowerCase().includes(lower));
      if (query === "" || matchName || matchDesc || matchTag) {
        results.push({ ...ext, marketplace: index.name });
      }
    }
  }

  return results;
}
