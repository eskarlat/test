import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Router } from "express";
import { loadExtension, type LoadedExtension } from "./extension-loader.js";
import { circuitBreaker } from "./extension-circuit-breaker.js";
import { eventBus } from "./event-bus.js";
import { logger } from "./logger.js";
import { dbManager } from "./db-manager.js";
import {
  registerExtensionProvider,
  unregisterExtensionProvider,
} from "./context-provider-manager.js";
import { hookFeatureRegistry } from "./hook-feature-registry.js";
import * as mcpManager from "./mcp-manager.js";
import type { ExtensionManifest } from "@renre-kit/extension-sdk";

export interface MountedExtensionInfo {
  name: string;
  version: string;
  status: "mounted" | "failed" | "suspended" | "incompatible";
  routeCount: number;
  mcpTransport?: string;
  mcpStatus?: string;
  error?: string;
  manifest?: ExtensionManifest;
}

interface MountedEntry {
  info: MountedExtensionInfo;
  loaded?: LoadedExtension;
  mountPath: string;
}

export interface ExtensionEntry {
  name: string;
  version: string;
  enabled: boolean;
  source: string;
  settings?: Record<string, unknown>;
}

// projectId → extensionName → entry
const mounted = new Map<string, Map<string, MountedEntry>>();

export function getRegistry(): Map<string, Map<string, MountedEntry>> {
  return mounted;
}

export function listMounted(projectId: string): MountedExtensionInfo[] {
  const exts = mounted.get(projectId);
  if (!exts) return [];
  return Array.from(exts.values()).map((e) => e.info);
}

export function getMountedInfo(
  projectId: string,
  extensionName: string,
): MountedExtensionInfo | null {
  return mounted.get(projectId)?.get(extensionName)?.info ?? null;
}

export async function mountExtension(
  projectId: string,
  extensionName: string,
  version: string,
  settingsConfig: Record<string, unknown> = {},
): Promise<MountedExtensionInfo> {
  const mountPath = `/api/${projectId}/${extensionName}`;

  // Check if suspended
  if (circuitBreaker.isSuspended(projectId, extensionName)) {
    const info: MountedExtensionInfo = {
      name: extensionName,
      version,
      status: "suspended",
      routeCount: 0,
      error: "Circuit breaker open",
    };
    upsertMounted(projectId, extensionName, { info, mountPath });
    return info;
  }

  try {
    const loaded = await loadExtension(extensionName, version, projectId, settingsConfig);

    const info: MountedExtensionInfo = {
      name: extensionName,
      version,
      status: "mounted",
      routeCount: loaded.routeCount,
      mcpTransport: loaded.mcpTransport,
      manifest: loaded.manifest,
    };

    upsertMounted(projectId, extensionName, { info, loaded, mountPath });

    // Register context provider if declared
    if (loaded.manifest.contextProvider) {
      registerExtensionProvider(extensionName, loaded.manifest);
    }

    // Register hook features if declared
    if (loaded.manifest.hooks) {
      const { events, timeout } = loaded.manifest.hooks;
      for (const event of events) {
        hookFeatureRegistry.registerExtension(
          extensionName,
          event,
          event,
          timeout,
        );
      }
    }

    eventBus.publish("extension:mounted", { projectId, name: extensionName, version });
    logger.info(`ext:${extensionName}`, `Mounted for project ${projectId} at ${mountPath}`);

    return info;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isIncompatible = (err as { incompatible?: boolean }).incompatible === true;

    circuitBreaker.recordError(projectId, extensionName);

    const info: MountedExtensionInfo = {
      name: extensionName,
      version,
      status: isIncompatible ? "incompatible" : "failed",
      routeCount: 0,
      error: msg,
    };

    upsertMounted(projectId, extensionName, { info, mountPath });
    eventBus.publish("extension:error", { projectId, name: extensionName, version, error: msg });
    logger.error(`ext:${extensionName}`, `Failed to mount for project ${projectId}: ${msg}`);

    return info;
  }
}

export async function unmountExtension(
  projectId: string,
  extensionName: string,
): Promise<void> {
  const exts = mounted.get(projectId);
  if (!exts) return;

  const entry = exts.get(extensionName);
  if (!entry) return;

  // Pause scheduler cron jobs before cleanup
  if (entry.loaded?.scheduler) {
    entry.loaded.scheduler.pauseAll();
  }

  exts.delete(extensionName);

  unregisterExtensionProvider(extensionName);
  hookFeatureRegistry.unregisterExtension(extensionName);
  mcpManager.disconnect(projectId, extensionName);
  circuitBreaker.reset(projectId, extensionName);

  eventBus.publish("extension:unmounted", { projectId, name: extensionName });
  logger.info(`ext:${extensionName}`, `Unmounted for project ${projectId}`);
}

export async function unmountAllForProject(projectId: string): Promise<void> {
  const exts = mounted.get(projectId);
  if (!exts) return;

  const names = Array.from(exts.keys());
  for (const name of names) {
    await unmountExtension(projectId, name);
  }
  mcpManager.disconnectAll(projectId);
  mounted.delete(projectId);
}

export async function remountExtension(
  projectId: string,
  extensionName: string,
  version: string,
  settingsConfig: Record<string, unknown> = {},
): Promise<MountedExtensionInfo> {
  await unmountExtension(projectId, extensionName);
  return mountExtension(projectId, extensionName, version, settingsConfig);
}

export function getRouter(projectId: string, extensionName: string): Router | null {
  const entry = mounted.get(projectId)?.get(extensionName);
  if (!entry?.loaded) return null;
  return entry.loaded.router;
}

function upsertMounted(
  projectId: string,
  extensionName: string,
  entry: MountedEntry,
): void {
  if (!mounted.has(projectId)) {
    mounted.set(projectId, new Map());
  }
  mounted.get(projectId)!.set(extensionName, entry);
}

export async function mountProjectExtensions(
  projectId: string,
  projectPath: string,
): Promise<MountedExtensionInfo[]> {
  const extensionsJsonPath = join(projectPath, ".renre-kit", "extensions.json");
  if (!existsSync(extensionsJsonPath)) return [];

  let entries: ExtensionEntry[];
  try {
    const raw = JSON.parse(
      readFileSync(extensionsJsonPath, "utf8"),
    ) as { extensions?: ExtensionEntry[] };
    entries = raw.extensions ?? [];
  } catch {
    logger.warn("worker", `Could not parse extensions.json for project ${projectId}`);
    return [];
  }

  // Check for orphaned migrations (extensions uninstalled while server was offline)
  await rollbackOrphanedMigrations(projectId, entries);

  const results: MountedExtensionInfo[] = [];
  for (const entry of entries) {
    if (!entry.enabled) continue;
    const info = await mountExtension(
      projectId,
      entry.name,
      entry.version,
      entry.settings ?? {},
    );
    results.push(info);
  }
  return results;
}

async function rollbackOrphanedMigrations(
  projectId: string,
  activeEntries: ExtensionEntry[],
): Promise<void> {
  try {
    const db = dbManager.getConnection();
    const appliedExtensions = db
      .prepare(
        "SELECT DISTINCT extension_name FROM _migrations WHERE project_id = ? AND extension_name != '__core__'",
      )
      .all(projectId) as Array<{ extension_name: string }>;

    const activeNames = new Set(activeEntries.map((e) => e.name));

    for (const { extension_name } of appliedExtensions) {
      if (!activeNames.has(extension_name)) {
        logger.info(
          "worker",
          `Rolling back orphaned migrations for ${extension_name} in project ${projectId}`,
        );
        // Extension directory no longer exists — clean tracking rows only
        db.prepare(
          "DELETE FROM _migrations WHERE extension_name = ? AND project_id = ?",
        ).run(extension_name, projectId);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("worker", `Orphaned migration check failed: ${msg}`);
  }
}

const MEMORY_WARN_THRESHOLD_BYTES = 512 * 1024 * 1024; // 512 MB

export function startMemoryMonitor(): void {
  setInterval(() => {
    const { heapUsed } = process.memoryUsage();
    if (heapUsed > MEMORY_WARN_THRESHOLD_BYTES) {
      const mb = Math.round(heapUsed / 1024 / 1024);
      logger.warn("worker", `High memory usage: ${mb}MB heap`);
      eventBus.publish("extension:error", {
        name: "__memory__",
        error: `High memory usage: ${mb}MB`,
      });
    }
  }, 30_000).unref();
}
