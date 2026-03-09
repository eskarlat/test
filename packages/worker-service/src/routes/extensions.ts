import { Router, type Request, type Response } from "express";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  listMounted,
  mountExtension,
  remountExtension,
  unmountExtension,
  type MountedExtensionInfo,
} from "../core/extension-registry.js";
import { eventBus } from "../core/event-bus.js";
import { logger } from "../core/logger.js";
import { getRegistry as getProjectRegistry } from "./projects.js";
import type { SettingDefinition } from "../core/settings-resolver.js";

interface ExtensionsJsonEntry {
  name: string;
  version: string;
  enabled: boolean;
  source: string;
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
  const file = join(projectPath, ".renre-kit", "extensions.json");
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function getSchema(ext: MountedExtensionInfo): SettingDefinition[] {
  const manifest = (ext as unknown as { manifest?: { settings?: { schema?: SettingDefinition[] } } }).manifest;
  return manifest?.settings?.schema ?? [];
}

const router = Router();

function requireProject(projectId: string | undefined, res: Response): boolean {
  if (!projectId) { res.status(400).json({ error: "Missing projectId" }); return false; }
  if (!getProjectRegistry().has(projectId)) { res.status(404).json({ error: "Project not found" }); return false; }
  return true;
}

function parseProjectExtensionRequest(req: Request, res: Response): { projectId: string; name: string } | null {
  const { id: projectId } = req.params;
  const { name } = req.body as { name?: string };
  if (!name) { res.status(400).json({ error: "Missing name" }); return null; }
  if (!requireProject(projectId, res)) return null;
  return { projectId: projectId!, name };
}

interface ActiveProject { path: string; mountedExtensions: MountedExtensionInfo[] }

function resolveSettingsRequest(
  req: Request,
  res: Response,
): { projectId: string; name: string; ext: MountedExtensionInfo; project: ActiveProject } | null {
  const { id: projectId, name } = req.params;
  if (!requireProject(projectId, res)) return null;
  const ext = listMounted(projectId!).find((e) => e.name === name);
  if (!ext) { res.status(404).json({ error: `Extension ${name as string} not mounted` }); return null; }
  const project = getProjectRegistry().get(projectId!) as ActiveProject | undefined;
  if (!project) { res.status(404).json({ error: "Project not found" }); return null; }
  return { projectId: projectId!, name: name as string, ext, project };
}

async function doRemount(
  projectId: string,
  name: string,
  version: string,
  settings: Record<string, unknown>,
  project: ActiveProject,
  res: Response,
  errorPrefix: string,
): Promise<void> {
  try {
    const info = await remountExtension(projectId, name, version, settings);
    const idx = project.mountedExtensions.findIndex((e) => e.name === name);
    if (idx >= 0) project.mountedExtensions[idx] = info;
    eventBus.publish("extension:remounted", { projectId, name, version });
    res.json({ ok: true, extension: info });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("worker", `${errorPrefix} ${name}: ${msg}`);
    res.status(500).json({ error: msg });
  }
}

// GET /api/:projectId/extensions — list mounted extensions for a project
router.get("/api/:projectId/extensions", (req: Request, res: Response) => {
  const { projectId } = req.params;
  if (!requireProject(projectId, res)) return;
  res.json(listMounted(projectId!));
});

// POST /api/projects/:id/extensions/reload — remount a specific extension
router.post(
  "/api/projects/:id/extensions/reload",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = parseProjectExtensionRequest(req, res);
    if (!parsed) return;
    const { projectId, name } = parsed;

    const ext = listMounted(projectId).find((e) => e.name === name);
    if (!ext) { res.status(404).json({ error: `Extension ${name} not mounted` }); return; }

    const project = getProjectRegistry().get(projectId) as ActiveProject | undefined;
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    await doRemount(projectId, name, ext.version, {}, project, res, "Failed to reload extension");
  },
);

// POST /api/projects/:id/extensions/unload — unload a specific extension
router.post(
  "/api/projects/:id/extensions/unload",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = parseProjectExtensionRequest(req, res);
    if (!parsed) return;
    const { projectId, name } = parsed;

    try {
      await unmountExtension(projectId, name);
      eventBus.publish("extension:unmounted", { projectId, name });
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  },
);

// POST /api/projects/:id/extensions/upgrade — upgrade an extension to a new version
router.post(
  "/api/projects/:id/extensions/upgrade",
  async (req: Request, res: Response): Promise<void> => {
    const { id: projectId } = req.params;
    const { name, targetVersion } = req.body as { name?: string; targetVersion?: string };

    if (!name || !targetVersion) {
      res.status(400).json({ error: "Missing name or targetVersion" });
      return;
    }
    if (!requireProject(projectId, res)) return;

    try {
      const info = await remountExtension(projectId!, name, targetVersion);
      eventBus.publish("extension:upgraded", { projectId, name, version: targetVersion });
      res.json({ ok: true, extension: info });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("worker", `Failed to upgrade extension ${name} to ${targetVersion}: ${msg}`);
      res.status(500).json({ error: msg });
    }
  },
);

// GET /api/projects/:id/extensions/:name/settings — get settings + schema
router.get("/api/projects/:id/extensions/:name/settings", (req: Request, res: Response) => {
  const resolved = resolveSettingsRequest(req, res);
  if (!resolved) return;
  const { name, ext, project } = resolved;

  const extJson = readExtensionsJson(project.path);
  const entry = extJson.extensions.find((e) => e.name === name);
  const rawSettings = entry?.settings ?? {};
  const schema = getSchema(ext);

  // Mask vault-type values in response
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawSettings)) {
    const def = schema.find((s) => s.key === k);
    masked[k] = def?.type === "vault" ? "--------" : v;
  }

  res.json({ settings: masked, schema });
});

// PUT /api/projects/:id/extensions/:name/settings — save settings and remount
router.put(
  "/api/projects/:id/extensions/:name/settings",
  async (req: Request, res: Response): Promise<void> => {
    const resolved = resolveSettingsRequest(req, res);
    if (!resolved) return;
    const { projectId, name, ext, project } = resolved;

    const newSettings = req.body as Record<string, unknown>;
    const schema = getSchema(ext);
    const extJson = readExtensionsJson(project.path);
    const entryIndex = extJson.extensions.findIndex((e) => e.name === name);

    if (entryIndex >= 0) {
      const entry = extJson.extensions[entryIndex];
      if (entry) {
        const existing = entry.settings ?? {};
        const merged: Record<string, unknown> = { ...existing };
        for (const [k, v] of Object.entries(newSettings)) {
          const def = schema.find((s) => s.key === k);
          if (def?.type === "vault" && v === "--------") continue; // preserve existing vault value
          merged[k] = v;
        }
        entry.settings = merged;
      }
    }

    writeExtensionsJson(project.path, extJson);
    res.setHeader("Retry-After", "3");

    const updatedSettings = entryIndex >= 0 ? (extJson.extensions[entryIndex]?.settings ?? {}) : {};
    await doRemount(projectId, name, ext.version, updatedSettings, project, res, "Settings saved but remount failed for");
  },
);

function resolveProjectExtensionFromJson(
  req: Request,
  res: Response,
): { projectId: string; name: string; project: ActiveProject; entry: ExtensionsJsonEntry; extJson: ExtensionsJson } | null {
  const { id: projectId, name } = req.params;
  if (!requireProject(projectId, res)) return null;

  const project = getProjectRegistry().get(projectId!) as ActiveProject | undefined;
  if (!project) { res.status(404).json({ error: "Project not found" }); return null; }

  const extJson = readExtensionsJson(project.path);
  const entry = extJson.extensions.find((e) => e.name === name);
  if (!entry) { res.status(404).json({ error: `Extension ${name as string} not installed` }); return null; }

  return { projectId: projectId!, name: name as string, project, entry, extJson };
}

function setExtensionEnabled(
  req: Request,
  res: Response,
  enabled: boolean,
): { projectId: string; name: string; project: ActiveProject; entry: ExtensionsJsonEntry } | null {
  const resolved = resolveProjectExtensionFromJson(req, res);
  if (!resolved) return null;
  const { projectId, name, project, entry, extJson } = resolved;
  entry.enabled = enabled;
  writeExtensionsJson(project.path, extJson);
  return { projectId, name, project, entry };
}

// POST /api/projects/:id/extensions/:name/enable — re-enable a disabled extension
router.post(
  "/api/projects/:id/extensions/:name/enable",
  async (req: Request, res: Response): Promise<void> => {
    const ctx = setExtensionEnabled(req, res, true);
    if (!ctx) return;
    const { projectId, name, project, entry } = ctx;

    try {
      const info = await mountExtension(projectId, name, entry.version, entry.settings ?? {});
      const idx = project.mountedExtensions.findIndex((e) => e.name === name);
      if (idx >= 0) {
        project.mountedExtensions[idx] = info;
      } else {
        project.mountedExtensions.push(info);
      }
      eventBus.publish("extension:enabled", { projectId, name, version: entry.version });
      res.json({ ok: true, extension: info });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("worker", `Failed to enable extension ${name}: ${msg}`);
      res.status(500).json({ error: msg });
    }
  },
);

// POST /api/projects/:id/extensions/:name/disable — disable a mounted extension
router.post(
  "/api/projects/:id/extensions/:name/disable",
  async (req: Request, res: Response): Promise<void> => {
    const ctx = setExtensionEnabled(req, res, false);
    if (!ctx) return;
    const { projectId, name, project } = ctx;

    try {
      await unmountExtension(projectId, name);
      project.mountedExtensions = project.mountedExtensions.filter((e) => e.name !== name);
      eventBus.publish("extension:disabled", { projectId, name });
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("worker", `Failed to disable extension ${name}: ${msg}`);
      res.status(500).json({ error: msg });
    }
  },
);

export default router;
