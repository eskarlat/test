import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { projectPaths, globalPaths } from "../utils/paths.js";

export interface ProjectJson {
  $schema?: string;
  id: string;
  name: string;
}

export interface ExtensionEntry {
  name: string;
  version: string;
  enabled: boolean;
  source: string;
  marketplace?: string;
  settings?: Record<string, unknown>;
}

export interface ExtensionsJson {
  $schema?: string;
  extensions: ExtensionEntry[];
}

export function readProjectJson(projectDir: string): ProjectJson | null {
  const paths = projectPaths(projectDir);
  if (!existsSync(paths.projectJson)) return null;
  return JSON.parse(readFileSync(paths.projectJson, "utf8")) as ProjectJson;
}

export function writeProjectJson(projectDir: string, data: ProjectJson): void {
  const paths = projectPaths(projectDir);
  mkdirSync(paths.renreKitDir, { recursive: true });
  writeFileSync(paths.projectJson, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function readExtensionsJson(projectDir: string): ExtensionsJson | null {
  const paths = projectPaths(projectDir);
  if (!existsSync(paths.extensionsJson)) return null;
  return JSON.parse(readFileSync(paths.extensionsJson, "utf8")) as ExtensionsJson;
}

export function writeExtensionsJson(projectDir: string, data: ExtensionsJson): void {
  const paths = projectPaths(projectDir);
  mkdirSync(paths.renreKitDir, { recursive: true });
  writeFileSync(paths.extensionsJson, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function readGlobalProjectMeta(projectId: string): Record<string, unknown> | null {
  const paths = globalPaths();
  const metaFile = join(paths.projectsDir, `${projectId}.json`);
  if (!existsSync(metaFile)) return null;
  return JSON.parse(readFileSync(metaFile, "utf8")) as Record<string, unknown>;
}

export function writeGlobalProjectMeta(projectId: string, meta: Record<string, unknown>): void {
  const paths = globalPaths();
  mkdirSync(paths.projectsDir, { recursive: true });
  const metaFile = join(paths.projectsDir, `${projectId}.json`);
  writeFileSync(metaFile, JSON.stringify(meta, null, 2) + "\n", "utf8");
}
