import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { globalPaths } from "../utils/paths.js";
import type { MarketplaceConfig } from "../utils/config.js";
import { buildMarketplaceFetchUrl } from "../shared/urls.js";

export interface MarketplaceExtension {
  name: string;
  version: string;
  description: string;
  repository: string;
  tags: string[];
  path?: string;
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

function cacheFilePath(): string {
  return join(globalPaths().globalDir, "marketplace-cache.json");
}

export async function fetchMarketplace(url: string): Promise<MarketplaceExtension[]> {
  const fetchUrl = buildMarketplaceFetchUrl(url);
  const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    throw new Error(`Failed to fetch marketplace from ${fetchUrl}: HTTP ${res.status}`);
  }
  const data = await res.json() as { extensions?: MarketplaceExtension[] };
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
  const ONE_HOUR_MS = 60 * 60 * 1000;
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
    } catch {
      // Skip failed marketplaces — caller handles warning
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

function parseInstallArg(installArg: string): { marketplace?: string; name: string; version?: string } {
  let remaining = installArg;
  let marketplace: string | undefined;

  if (remaining.includes("/")) {
    const slashIdx = remaining.indexOf("/");
    marketplace = remaining.slice(0, slashIdx);
    remaining = remaining.slice(slashIdx + 1);
  }

  let name = remaining;
  let version: string | undefined;

  if (remaining.includes("@")) {
    const atIdx = remaining.lastIndexOf("@");
    name = remaining.slice(0, atIdx);
    version = remaining.slice(atIdx + 1);
  }

  return { marketplace, name, version };
}

export function resolveExtension(
  cache: MarketplaceCache,
  installArg: string,
): { marketplaceName: string; ext: MarketplaceExtension } | null {
  const { marketplace, name, version } = parseInstallArg(installArg);

  for (const index of cache.marketplaces) {
    if (marketplace && index.name !== marketplace) continue;
    const ext = index.extensions.find((e) => {
      const nameMatch = e.name === name;
      const versionMatch = version ? e.version === version : true;
      return nameMatch && versionMatch;
    });
    if (ext) return { marketplaceName: index.name, ext };
  }

  return null;
}
