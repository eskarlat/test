import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Router } from "express";
import { globalPaths } from "./paths.js";
import { dbManager } from "./db-manager.js";
import { logger } from "./logger.js";
import { validateManifest } from "./manifest-validator.js";
import { circuitBreaker } from "./extension-circuit-breaker.js";
import type { ExtensionManifest, ExtensionContext, MCPClient } from "@renre-kit/extension-sdk";
import { resolveSettings } from "./settings-resolver.js";
import * as mcpManager from "./mcp-manager.js";
import { getRegistry as getProjectRegistry } from "../routes/projects.js";
import { copilotBridge } from "./copilot-bridge.js";
import { createScopedLLM } from "./scoped-llm.js";
import { ScopedScheduler } from "./scoped-scheduler.js";
import type { Server } from "socket.io";

// Module-level Socket.IO instance for scheduler wiring
let ioInstance: Server | null = null;

export function setExtensionLoaderIO(io: Server): void {
  ioInstance = io;
}

export interface LoadedExtension {
  readonly name: string;
  readonly version: string;
  readonly router: Router;
  readonly manifest: ExtensionManifest;
  readonly routeCount: number;
  readonly mcpTransport?: string;
  readonly scheduler?: ScopedScheduler;
}

export interface ExtensionLoadError {
  readonly name: string;
  readonly version: string;
  readonly error: string;
  readonly incompatible?: boolean;
}

interface RouterLayer {
  route?: { path: string };
}

function countRoutes(router: Router): number {
  const stack = (router as unknown as { stack: RouterLayer[] }).stack;
  if (!Array.isArray(stack)) return 0;
  return stack.filter((layer) => layer.route !== undefined).length;
}

function readManifest(extDir: string): ExtensionManifest {
  const manifestPath = join(extDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing manifest.json in ${extDir}`);
  }
  return JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest;
}

function assertManifestValid(
  manifest: ExtensionManifest,
  extensionName: string,
  version: string,
): void {
  const extDir = join(globalPaths().extensionsDir, extensionName, version);
  const validation = validateManifest(manifest, extDir);
  if (validation.incompatible) {
    const err = Object.assign(
      new Error(
        `Extension ${extensionName}@${version} is incompatible with current SDK version`,
      ),
      { incompatible: true },
    );
    throw err;
  }
  if (!validation.valid) {
    throw new Error(
      `Invalid manifest for ${extensionName}@${version}: ${validation.errors.join("; ")}`,
    );
  }
  for (const warning of validation.warnings) {
    logger.warn(`ext:${extensionName}`, warning);
  }
}

function buildContext(
  extensionName: string,
  projectId: string,
  manifest: ExtensionManifest,
  settingsConfig: Record<string, unknown>,
): ExtensionContext {
  const settingsSchema = manifest.settings?.schema ?? [];
  const vaultKeys = Array.isArray(manifest.permissions?.vault)
    ? manifest.permissions.vault
    : [];
  const resolvedConfig = resolveSettings(settingsSchema, settingsConfig, vaultKeys);

  const db = manifest.permissions?.database === true
    ? dbManager.createScopedProxy(extensionName, projectId)
    : null;

  const extLogger = {
    error: (msg: string, meta?: Record<string, unknown>) =>
      logger.error(`ext:${extensionName}`, msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) =>
      logger.warn(`ext:${extensionName}`, msg, meta),
    info: (msg: string, meta?: Record<string, unknown>) =>
      logger.info(`ext:${extensionName}`, msg, meta),
    debug: (msg: string, meta?: Record<string, unknown>) =>
      logger.debug(`ext:${extensionName}`, msg, meta),
  };

  let mcp: MCPClient | null = null;
  if (manifest.mcp) {
    try {
      mcp = mcpManager.connect(projectId, extensionName, manifest.mcp);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`ext:${extensionName}`, `MCP connection failed (non-fatal): ${msg}`);
    }
  }

  // Wire ScopedLLM if extension declares llm permission.
  // Bridge is lazy-initialized (ADR-047 §2.1) — ensureStarted() is called
  // transparently on first ScopedLLM operation, so no readiness check here.
  const llm =
    manifest.permissions?.llm === true
      ? createScopedLLM(extensionName, projectId, copilotBridge)
      : null;

  // Wire ScopedScheduler only if extension declares scheduler permission
  let scheduler: ScopedScheduler | null = null;
  if (manifest.permissions?.scheduler === true && ioInstance) {
    scheduler = new ScopedScheduler(
      dbManager.getConnection(),
      ioInstance,
      extensionName,
      projectId,
      { db, logger: extLogger, config: resolvedConfig, mcp },
    );
  }

  const projectEntry = getProjectRegistry().get(projectId);
  const projectDir = projectEntry?.path ?? process.cwd();

  return {
    projectId,
    projectDir,
    db,
    logger: extLogger,
    config: resolvedConfig,
    mcp,
    llm,
    scheduler,
  };
}

function loadRouter(
  extDir: string,
  extensionName: string,
  manifest: ExtensionManifest,
  context: ExtensionContext,
): Router {
  if (!manifest.backend?.entrypoint) {
    throw new Error(`Extension ${extensionName} has no backend entrypoint`);
  }
  const entrypointPath = join(extDir, manifest.backend.entrypoint);
  if (!existsSync(entrypointPath)) {
    throw new Error(`Backend entrypoint not found: ${entrypointPath}`);
  }

  type RouterFactory = (ctx: ExtensionContext) => Router;
  const require = createRequire(import.meta.url);
  const rawFactory = require(entrypointPath) as RouterFactory | { default: RouterFactory };
  const routerFactory = typeof rawFactory === "function" ? rawFactory : rawFactory.default;

  if (typeof routerFactory !== "function") {
    throw new Error(
      `Extension ${extensionName} backend does not export a router factory function`,
    );
  }
  return routerFactory(context);
}

export async function loadExtension(
  extensionName: string,
  version: string,
  projectId: string,
  settingsConfig: Record<string, unknown>,
): Promise<LoadedExtension> {
  const { extensionsDir } = globalPaths();
  const extDir = join(extensionsDir, extensionName, version);

  if (!existsSync(extDir)) {
    throw new Error(`Extension directory not found: ${extDir}`);
  }

  const manifest = readManifest(extDir);
  assertManifestValid(manifest, extensionName, version);

  if (manifest.migrations) {
    const migrationsDir = join(extDir, manifest.migrations);
    if (existsSync(migrationsDir)) {
      dbManager.runExtensionMigrations(extensionName, projectId, migrationsDir);
    }
  }

  const context = buildContext(extensionName, projectId, manifest, settingsConfig);
  const router = loadRouter(extDir, extensionName, manifest, context);
  const routeCount = countRoutes(router);

  // Start cron scheduler if the extension has one
  const scheduler = context.scheduler as ScopedScheduler | null;
  if (scheduler) {
    scheduler.loadAndSchedule();
  }

  // Record successful load (reset any prior error state)
  circuitBreaker.recordSuccess(projectId, extensionName);

  const result: LoadedExtension = {
    name: extensionName,
    version,
    router,
    manifest,
    routeCount,
  };

  if (manifest.mcp?.transport) {
    (result as { mcpTransport: string }).mcpTransport = manifest.mcp.transport;
  }
  if (scheduler) {
    (result as { scheduler: ScopedScheduler }).scheduler = scheduler;
  }

  return result;
}
