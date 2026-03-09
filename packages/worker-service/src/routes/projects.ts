import { Router, type Request, type Response } from "express";
import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { globalPaths } from "../core/paths.js";
import { eventBus } from "../core/event-bus.js";
import { logger } from "../core/logger.js";
import { setFilePermissions } from "../shared/platform.js";
import { mountProjectExtensions, unmountAllForProject } from "../core/extension-registry.js";

export interface ActiveProject {
  id: string;
  name: string;
  path: string;
  extensionCount: number;
  registeredAt: string;
  lastActiveAt: string;
  mountedExtensions: MountedExtension[];
}

export interface MountedExtension {
  name: string;
  version: string;
  status: "mounted" | "failed" | "suspended";
  routeCount: number;
  mcpTransport?: string;
  mcpStatus?: string;
  error?: string;
}

export interface ServerState {
  pid: number;
  port: number;
  startedAt: string;
  activeProjects: string[];
}

// In-memory project registry
const registry = new Map<string, ActiveProject>();

export function getRegistry(): Map<string, ActiveProject> {
  return registry;
}

export function readServerState(): ServerState | null {
  const { serverJson } = globalPaths();
  if (!existsSync(serverJson)) return null;
  try {
    return JSON.parse(readFileSync(serverJson, "utf8")) as ServerState;
  } catch {
    return null;
  }
}

function writeServerState(state: ServerState): void {
  const { serverJson } = globalPaths();
  writeFileSync(serverJson, JSON.stringify(state, null, 2) + "\n", "utf8");
  setFilePermissions(serverJson, 0o600);
}

function updateGlobalProjectMeta(projectId: string, updates: Record<string, unknown>): void {
  const { globalDir } = globalPaths();
  const projectsDir = join(globalDir, "projects");
  mkdirSync(projectsDir, { recursive: true });
  const metaFile = join(projectsDir, `${projectId}.json`);
  let existing: Record<string, unknown> = {};
  if (existsSync(metaFile)) {
    try {
      existing = JSON.parse(readFileSync(metaFile, "utf8")) as Record<string, unknown>;
    } catch { /* ignore */ }
  }
  const updated = { ...existing, ...updates };
  writeFileSync(metaFile, JSON.stringify(updated, null, 2) + "\n", "utf8");
}

const router = Router();

router.post("/api/projects/register", async (req: Request, res: Response): Promise<void> => {
  const { id, name, path: projectPath } = req.body as {
    id: string;
    name: string;
    path: string;
  };

  if (!id || !name || !projectPath) {
    res.status(400).json({ error: "Missing required fields: id, name, path" });
    return;
  }

  const now = new Date().toISOString();
  const project: ActiveProject = {
    id,
    name,
    path: projectPath,
    extensionCount: 0,
    registeredAt: now,
    lastActiveAt: now,
    mountedExtensions: [],
  };

  registry.set(id, project);

  try {
    // Mount extensions for this project
    const mountedExts = await mountProjectExtensions(id, projectPath);
    project.mountedExtensions = mountedExts;
    project.extensionCount = mountedExts.filter((e) => e.status === "mounted").length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("worker", `Extension mount failed for project ${id}: ${msg}`);
  }

  // Update server.json
  const state = readServerState();
  if (state) {
    if (!state.activeProjects.includes(id)) {
      state.activeProjects.push(id);
    }
    writeServerState(state);
  }

  // Update global project metadata
  updateGlobalProjectMeta(id, { id, name, path: projectPath, lastActiveAt: now });

  eventBus.publish("project:registered", { id, name, path: projectPath });
  logger.info("worker", `Project registered: ${name} (${id})`);

  res.json({
    success: true,
    projectId: id,
    extensions: project.mountedExtensions,
  });
});

router.post("/api/projects/unregister", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.body as { id: string };

  if (!id) {
    res.status(400).json({ error: "Missing required field: id" });
    return;
  }

  const project = registry.get(id);
  if (!project) {
    res.status(404).json({ error: "Project not registered" });
    return;
  }

  await unmountAllForProject(id);
  registry.delete(id);

  // Update server.json
  const state = readServerState();
  if (state) {
    state.activeProjects = state.activeProjects.filter((pid) => pid !== id);
    writeServerState(state);
  }

  eventBus.publish("project:unregistered", { id, name: project.name });
  logger.info("worker", `Project unregistered: ${project.name} (${id})`);

  res.json({ success: true });
});

router.get("/api/projects", (_req: Request, res: Response) => {
  const projects = Array.from(registry.values()).map((p) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    extensionCount: p.extensionCount,
    registeredAt: p.registeredAt,
    lastActiveAt: p.lastActiveAt,
    mountedExtensions: p.mountedExtensions,
  }));
  res.json(projects);
});

export default router;
