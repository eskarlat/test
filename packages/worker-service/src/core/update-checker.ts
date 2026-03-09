import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger.js";
import { eventBus } from "./event-bus.js";
import { loadCache, type MarketplaceCache } from "../services/marketplace-client.js";

interface InstalledExtension {
  name: string;
  version: string;
}

interface ExtensionsJson {
  extensions?: InstalledExtension[];
}

interface UpdateInfo {
  name: string;
  current: string;
  latest: string;
}

type ProjectRegistry = Map<string, { path: string }>;

function readInstalledExtensions(projectPath: string): InstalledExtension[] {
  const filePath = join(projectPath, ".renre-kit", "extensions.json");
  if (!existsSync(filePath)) return [];
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8")) as ExtensionsJson;
    return Array.isArray(data.extensions) ? data.extensions : [];
  } catch {
    return [];
  }
}

function buildLatestVersionMap(cache: MarketplaceCache): Map<string, string> {
  const latestVersions = new Map<string, string>();
  for (const mp of cache.marketplaces) {
    for (const ext of mp.extensions) {
      const existing = latestVersions.get(ext.name);
      if (!existing || compareVersions(ext.version, existing) > 0) {
        latestVersions.set(ext.name, ext.version);
      }
    }
  }
  return latestVersions;
}

function collectUpdates(
  projectRegistry: ProjectRegistry,
  latestVersions: Map<string, string>,
): UpdateInfo[] {
  const updates: UpdateInfo[] = [];
  const seen = new Set<string>();

  for (const project of projectRegistry.values()) {
    for (const ext of readInstalledExtensions(project.path)) {
      const latest = latestVersions.get(ext.name);
      if (latest && !seen.has(ext.name) && compareVersions(latest, ext.version) > 0) {
        seen.add(ext.name);
        updates.push({ name: ext.name, current: ext.version, latest });
      }
    }
  }

  return updates;
}

export async function checkAndEmitUpdates(
  projectRegistry: ProjectRegistry,
): Promise<void> {
  if (projectRegistry.size === 0) return;

  const cache = loadCache();
  if (!cache || cache.marketplaces.length === 0) return;

  const latestVersions = buildLatestVersionMap(cache);
  const updates = collectUpdates(projectRegistry, latestVersions);

  if (updates.length > 0) {
    logger.info("update-checker", `Found ${updates.length} extension update(s) available`);
    eventBus.publish("updates:available", { extensions: updates });
  }
}

/** Compares semver-like strings. Returns positive if a > b, negative if a < b, 0 if equal. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
