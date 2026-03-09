import { Router, type Request, type Response } from "express";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  loadCache,
  isCacheStale,
  refreshCache,
  searchExtensions,
  type MarketplaceExtension,
} from "../services/marketplace-client.js";
import {
  mountExtension,
  unmountExtension,
  remountExtension,
  listMounted,
} from "../core/extension-registry.js";
import { eventBus } from "../core/event-bus.js";
import { logger } from "../core/logger.js";
import { globalPaths } from "../core/paths.js";
import { getRegistry as getProjectRegistry } from "./projects.js";
import { DEFAULT_MARKETPLACE_URL } from "../shared/urls.js";

const router = Router();

// ─── Config helpers ───────────────────────────────────────────────────────────

interface MarketplaceConfig {
  name: string;
  url: string;
}

interface WorkerConfig {
  marketplaces?: MarketplaceConfig[];
}

function readWorkerConfig(): WorkerConfig {
  const { configFile } = globalPaths();
  if (!existsSync(configFile)) {
    return {
      marketplaces: [
        { name: "RenRe Kit Official Marketplace", url: DEFAULT_MARKETPLACE_URL },
      ],
    };
  }
  try {
    return JSON.parse(readFileSync(configFile, "utf8")) as WorkerConfig;
  } catch {
    return { marketplaces: [] };
  }
}

function getMarketplaces(): MarketplaceConfig[] {
  const config = readWorkerConfig();
  if (Array.isArray(config.marketplaces) && config.marketplaces.length > 0) {
    return config.marketplaces;
  }
  return [
    { name: "RenRe Kit Official Marketplace", url: DEFAULT_MARKETPLACE_URL },
  ];
}

// ─── Project helpers ──────────────────────────────────────────────────────────

interface ActiveProject {
  path: string;
}

function requireProject(projectId: string | undefined, res: Response): boolean {
  if (!projectId) {
    res.status(400).json({ error: "Missing projectId" });
    return false;
  }
  if (!getProjectRegistry().has(projectId)) {
    res.status(404).json({ error: "Project not found" });
    return false;
  }
  return true;
}

/** Express 5 types `req.params` as `string | string[]` — extract as plain string */
function param(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

// ─── extensions.json helpers ─────────────────────────────────────────────────

interface ExtensionsJsonEntry {
  name: string;
  version: string;
  enabled: boolean;
  source: string;
  marketplace?: string;
  installedAt?: string;
  settings?: Record<string, unknown>;
}

interface ExtensionsJson {
  extensions: ExtensionsJsonEntry[];
}

function readExtensionsJson(projectPath: string): ExtensionsJson {
  const file = join(projectPath, ".renre-kit", "extensions.json");
  if (!existsSync(file)) return { extensions: [] };
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ExtensionsJson;
  } catch {
    return { extensions: [] };
  }
}

function writeExtensionsJson(projectPath: string, data: ExtensionsJson): void {
  const dir = join(projectPath, ".renre-kit");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "extensions.json");
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ─── Hook helpers (mirror CLI behaviour) ─────────────────────────────────────

interface HookEntry {
  type: "command";
  command: string;
}

interface CopilotHookFile {
  hooks: Record<string, HookEntry[]>;
}

// Mapping from internal camelCase event names to Copilot PascalCase event names
const EVENT_TO_COPILOT: Record<string, string> = {
  sessionStart: "SessionStart",
  sessionEnd: "Stop",
  userPromptSubmitted: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  errorOccurred: "ErrorOccurred",
  preCompact: "PreCompact",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
};

// Reverse mapping: Copilot PascalCase → internal camelCase
const COPILOT_TO_EVENT: Record<string, string> = {};
for (const [internal, copilot] of Object.entries(EVENT_TO_COPILOT)) {
  COPILOT_TO_EVENT[copilot] = internal;
}

interface ManifestHooks {
  events?: string[];
}

interface ManifestSkill {
  name?: string;
}

interface ExtensionManifestLike {
  name?: unknown;
  version?: unknown;
  sdkVersion?: unknown;
  permissions?: Record<string, unknown>;
  hooks?: ManifestHooks;
  skills?: ManifestSkill[];
}

function readManifestFromDir(extensionDir: string): ExtensionManifestLike {
  const manifestPath = join(extensionDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${extensionDir}`);
  }
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifestLike;
  if (!raw.name || !raw.version || !raw.sdkVersion) {
    throw new Error("manifest.json missing required fields: name, version, sdkVersion");
  }
  return raw;
}

function readCopilotHookFile(filePath: string): Map<string, HookEntry[]> {
  const map = new Map<string, HookEntry[]>();
  if (!existsSync(filePath)) return map;
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8")) as CopilotHookFile;
    if (data.hooks && typeof data.hooks === "object" && !Array.isArray(data.hooks)) {
      for (const [copilotEvent, entries] of Object.entries(data.hooks)) {
        const internalEvent = COPILOT_TO_EVENT[copilotEvent] ?? copilotEvent;
        map.set(internalEvent, entries);
      }
    }
  } catch {
    /* return empty map */
  }
  return map;
}

function writeCopilotHookFile(filePath: string, byEvent: Map<string, HookEntry[]>): void {
  const hooks: Record<string, HookEntry[]> = {};
  for (const [event, hookEntries] of byEvent) {
    const copilotEvent = EVENT_TO_COPILOT[event] ?? event;
    hooks[copilotEvent] = hookEntries;
  }
  const output: CopilotHookFile = { hooks };
  writeFileSync(filePath, JSON.stringify(output, null, 2) + "\n", "utf8");
}

function addExtensionHooksToProject(
  projectPath: string,
  extensionName: string,
  events: string[],
): void {
  if (events.length === 0) return;
  const hooksDir = join(projectPath, ".github", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hooksFile = join(hooksDir, "renre-kit.json");

  const byEvent = readCopilotHookFile(hooksFile);
  const scriptPath = join(globalPaths().globalDir, "scripts", "worker-service.cjs");

  for (const event of events) {
    const eventHooks = byEvent.get(event) ?? [];
    const cmd = `node ${scriptPath} hook agent ${event} ${extensionName}`;
    if (!eventHooks.some((h) => h.command === cmd)) {
      eventHooks.push({ type: "command", command: cmd });
    }
    byEvent.set(event, eventHooks);
  }

  writeCopilotHookFile(hooksFile, byEvent);
}

function removeExtensionHooksFromProject(projectPath: string, extensionName: string): void {
  const hooksFile = join(projectPath, ".github", "hooks", "renre-kit.json");
  if (!existsSync(hooksFile)) return;
  try {
    const byEvent = readCopilotHookFile(hooksFile);
    for (const [event, hooks] of byEvent) {
      byEvent.set(event, hooks.filter((h) => !h.command.includes(` ${extensionName}:`)));
    }
    writeCopilotHookFile(hooksFile, byEvent);
  } catch {
    // Non-fatal
  }
}

function copySkillsToProject(
  projectPath: string,
  extensionDir: string,
  skills: ManifestSkill[] | undefined,
): void {
  if (!Array.isArray(skills) || skills.length === 0) return;
  for (const skill of skills) {
    const skillName = typeof skill.name === "string" ? skill.name : null;
    if (!skillName) continue;

    const pathA = join(extensionDir, "skills", `${skillName}.md`);
    const pathB = join(extensionDir, "skills", skillName, "SKILL.md");
    let sourcePath: string | null = null;
    if (existsSync(pathA)) sourcePath = pathA;
    else if (existsSync(pathB)) sourcePath = pathB;
    if (!sourcePath) continue;

    const destDir = join(projectPath, ".github", "skills", skillName);
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "SKILL.md"), readFileSync(sourcePath, "utf8"), "utf8");
  }
}

function removeSkillsFromProject(
  projectPath: string,
  skills: ManifestSkill[] | undefined,
): void {
  if (!Array.isArray(skills) || skills.length === 0) return;
  for (const skill of skills) {
    const skillName = typeof skill.name === "string" ? skill.name : null;
    if (!skillName) continue;
    const skillDir = join(projectPath, ".github", "skills", skillName);
    if (existsSync(skillDir)) {
      try {
        rmSync(skillDir, { recursive: true });
      } catch {
        // Non-fatal
      }
    }
  }
}

// ─── Download helper ─────────────────────────────────────────────────────────

function looksLikeTag(version: string): boolean {
  return version.includes(".");
}

async function downloadExtension(
  name: string,
  version: string,
  repository: string,
): Promise<string> {
  const destDir = join(globalPaths().extensionsDir, name, version);
  if (existsSync(destDir)) return destDir;

  mkdirSync(destDir, { recursive: true });

  const args = looksLikeTag(version)
    ? ["clone", "--depth=1", "--branch", version, repository, destDir]
    : ["clone", "--depth=1", repository, destDir];

  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const result = spawnSync("git", args, { stdio: "inherit" });
  if (result.status !== 0) {
    // Clean up partial directory
    try { rmSync(destDir, { recursive: true }); } catch { /* ignore */ }
    throw new Error("git clone failed");
  }

  return destDir;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/marketplace
 * Fetch and merge extension lists from all registered marketplaces.
 * Returns cached data (refreshed if stale >1h).
 */
router.get("/api/marketplace", async (_req: Request, res: Response): Promise<void> => {
  try {
    const marketplaces = getMarketplaces();
    let cache = loadCache();

    if (!cache || isCacheStale(cache)) {
      cache = await refreshCache(marketplaces);
    }

    // Flatten extensions with marketplace name
    const extensions = cache.marketplaces.flatMap((mp) =>
      mp.extensions.map((ext) => ({ ...ext, marketplace: mp.name })),
    );

    res.json({
      extensions,
      marketplaces: cache.marketplaces.map((mp) => ({ name: mp.name, url: mp.url })),
      fetchedAt: cache.fetchedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("marketplace", `Failed to fetch marketplace: ${msg}`);
    res.status(500).json({ error: "Failed to fetch marketplace" });
  }
});

/**
 * GET /api/marketplace/search?q=term
 * Search across all marketplaces by name/description/tags.
 */
router.get("/api/marketplace/search", async (req: Request, res: Response): Promise<void> => {
  const query = typeof req.query["q"] === "string" ? req.query["q"] : "";

  try {
    const marketplaces = getMarketplaces();
    let cache = loadCache();

    if (!cache || isCacheStale(cache)) {
      cache = await refreshCache(marketplaces);
    }

    const results = searchExtensions(cache, query);
    res.json({ extensions: results, query });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("marketplace", `Search failed: ${msg}`);
    res.status(500).json({ error: "Search failed" });
  }
});

interface InstallBody {
  name?: string;
  version?: string;
  repository?: string;
  marketplace?: string;
  settings?: Record<string, unknown>;
}

/**
 * POST /api/:projectId/extensions/install
 * Full install: download from marketplace, validate manifest, copy hooks/skills,
 * update extensions.json, mount extension.
 */
router.post(
  "/api/:projectId/extensions/install",
  async (req: Request, res: Response): Promise<void> => {
    const projectId = param(req.params["projectId"]);
    if (!requireProject(projectId, res)) return;

    const { name, version, repository, marketplace, settings = {} } =
      req.body as InstallBody;

    if (!name || !version || !repository) {
      res.status(400).json({ error: "Missing required fields: name, version, repository" });
      return;
    }

    const project = getProjectRegistry().get(projectId!) as ActiveProject | undefined;
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    logger.info("marketplace", `Installing ${name}@${version} for project ${projectId!}`);

    // Download extension
    let extensionDir: string;
    try {
      extensionDir = await downloadExtension(name, version, repository);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("marketplace", `Download failed for ${name}@${version}: ${msg}`);
      res.status(500).json({ error: `Download failed: ${msg}` });
      return;
    }

    // Validate manifest
    let manifest: ExtensionManifestLike;
    try {
      manifest = readManifestFromDir(extensionDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: `Manifest validation failed: ${msg}` });
      return;
    }

    // Copy hooks and skills
    if (manifest.hooks?.events?.length) {
      addExtensionHooksToProject(project.path, name, manifest.hooks.events);
    }
    copySkillsToProject(project.path, extensionDir, manifest.skills);

    // Update extensions.json
    const extJson = readExtensionsJson(project.path);
    const existingIdx = extJson.extensions.findIndex((e) => e.name === name);
    const entry: ExtensionsJsonEntry = {
      name,
      version,
      enabled: true,
      source: repository,
      marketplace: marketplace ?? "unknown",
      installedAt: new Date().toISOString(),
      settings,
    };

    if (existingIdx >= 0) {
      extJson.extensions[existingIdx] = entry;
    } else {
      extJson.extensions.push(entry);
    }
    writeExtensionsJson(project.path, extJson);

    // Mount extension
    let mountedInfo;
    try {
      mountedInfo = await mountExtension(projectId!, name, version, settings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("marketplace", `Mount failed for ${name}@${version}: ${msg}`);
      res.status(500).json({ error: `Install succeeded but mount failed: ${msg}` });
      return;
    }

    eventBus.publish("extension:installed", { projectId: projectId!, name, version });
    logger.info("marketplace", `Successfully installed ${name}@${version} for project ${projectId!}`);

    res.json({ ok: true, extension: mountedInfo });
  },
);

/**
 * DELETE /api/:projectId/extensions/:name
 * Full remove: unmount + remove hooks/skills + update extensions.json.
 */
router.delete(
  "/api/:projectId/extensions/:name",
  async (req: Request, res: Response): Promise<void> => {
    const projectId = param(req.params["projectId"]);
    const name = param(req.params["name"]);
    if (!requireProject(projectId, res)) return;

    if (!name) {
      res.status(400).json({ error: "Missing extension name" });
      return;
    }

    const project = getProjectRegistry().get(projectId!) as ActiveProject | undefined;
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const extJson = readExtensionsJson(project.path);
    const entry = extJson.extensions.find((e) => e.name === name);
    if (!entry) {
      res.status(404).json({ error: `Extension "${name as string}" not installed` });
      return;
    }

    // Unmount (may not be mounted if disabled)
    try {
      await unmountExtension(projectId!, name as string);
    } catch {
      // Non-fatal — extension may already be unmounted
    }

    // Remove hooks and skills using cached manifest if available
    const extensionDir = join(globalPaths().extensionsDir, name as string, entry.version);
    if (existsSync(extensionDir)) {
      try {
        const manifest = readManifestFromDir(extensionDir);
        removeExtensionHooksFromProject(project.path, name as string);
        removeSkillsFromProject(project.path, manifest.skills);
      } catch {
        // Non-fatal — just remove the JSON entry
        removeExtensionHooksFromProject(project.path, name as string);
      }
    } else {
      removeExtensionHooksFromProject(project.path, name as string);
    }

    // Update extensions.json
    extJson.extensions = extJson.extensions.filter((e) => e.name !== name);
    writeExtensionsJson(project.path, extJson);

    eventBus.publish("extension:removed", { projectId: projectId!, name: name as string });
    logger.info("marketplace", `Removed ${name as string} from project ${projectId!}`);

    res.json({ ok: true });
  },
);

/**
 * POST /api/:projectId/extensions/:name/upgrade
 * Upgrade extension to a new version: download + remount.
 */
router.post(
  "/api/:projectId/extensions/:name/upgrade",
  async (req: Request, res: Response): Promise<void> => {
    const projectId = param(req.params["projectId"]);
    const name = param(req.params["name"]);
    if (!requireProject(projectId, res)) return;

    if (!name) {
      res.status(400).json({ error: "Missing extension name" });
      return;
    }

    const { version, repository } = req.body as { version?: string; repository?: string };
    if (!version) {
      res.status(400).json({ error: "Missing target version" });
      return;
    }

    const project = getProjectRegistry().get(projectId!) as ActiveProject | undefined;
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const extJson = readExtensionsJson(project.path);
    const entryIndex = extJson.extensions.findIndex((e) => e.name === name);
    if (entryIndex < 0) {
      res.status(404).json({ error: `Extension "${name as string}" not installed` });
      return;
    }

    const entry = extJson.extensions[entryIndex]!;
    const repo = repository ?? entry.source;

    // Download new version
    if (repo) {
      try {
        await downloadExtension(name as string, version, repo);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: `Download failed: ${msg}` });
        return;
      }
    }

    // Update extensions.json
    const oldVersion = entry.version;
    entry.version = version;
    writeExtensionsJson(project.path, extJson);

    // Remount with new version
    try {
      const info = await remountExtension(
        projectId!,
        name as string,
        version,
        entry.settings ?? {},
      );
      eventBus.publish("extension:upgraded", {
        projectId: projectId!,
        name: name as string,
        oldVersion,
        newVersion: version,
      });
      logger.info(
        "marketplace",
        `Upgraded ${name as string} from ${oldVersion} to ${version} for project ${projectId!}`,
      );
      res.json({ ok: true, extension: info });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("marketplace", `Upgrade remount failed for ${name as string}: ${msg}`);
      res.status(500).json({ error: `Upgrade succeeded but remount failed: ${msg}` });
    }
  },
);

/**
 * GET /api/marketplace/extensions
 * List all marketplace extensions with installed-status overlay per project.
 * Query param: projectId (optional) to annotate which are installed.
 */
router.get(
  "/api/marketplace/extensions",
  async (req: Request, res: Response): Promise<void> => {
    const projectId =
      typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;

    try {
      const marketplaces = getMarketplaces();
      let cache = loadCache();
      if (!cache || isCacheStale(cache)) {
        cache = await refreshCache(marketplaces);
      }

      const installedNames = new Set<string>();
      if (projectId && getProjectRegistry().has(projectId)) {
        const project = getProjectRegistry().get(projectId) as ActiveProject | undefined;
        if (project) {
          const extJson = readExtensionsJson(project.path);
          for (const ext of extJson.extensions) installedNames.add(ext.name);
        }
      }

      const extensions = cache.marketplaces.flatMap((mp) =>
        mp.extensions.map((ext: MarketplaceExtension) => ({
          ...ext,
          marketplace: mp.name,
          installed: installedNames.has(ext.name),
        })),
      );

      res.json({
        extensions,
        marketplaces: cache.marketplaces.map((mp) => ({ name: mp.name, url: mp.url })),
        fetchedAt: cache.fetchedAt,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("marketplace", `Failed to list marketplace extensions: ${msg}`);
      res.status(500).json({ error: "Failed to list marketplace extensions" });
    }
  },
);

/**
 * GET /api/:projectId/extensions/:name/info
 * Get detailed info about an installed extension including manifest.
 */
router.get(
  "/api/:projectId/extensions/:name/info",
  (req: Request, res: Response): void => {
    const projectId = param(req.params["projectId"]);
    const name = param(req.params["name"]);
    if (!requireProject(projectId, res)) return;

    const project = getProjectRegistry().get(projectId!) as ActiveProject | undefined;
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const extJson = readExtensionsJson(project.path);
    const entry = extJson.extensions.find((e) => e.name === name);
    if (!entry) {
      res.status(404).json({ error: `Extension "${name as string}" not installed` });
      return;
    }

    // Try to get mounted info for live status
    const mounted = listMounted(projectId!);
    const mountedInfo = mounted.find((m) => m.name === name);

    res.json({
      ...entry,
      status: mountedInfo?.status ?? "disabled",
      manifest: mountedInfo?.manifest ?? null,
      error: mountedInfo?.error ?? null,
    });
  },
);

export default router;
