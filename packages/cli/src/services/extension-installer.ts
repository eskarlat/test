import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import * as clack from "@clack/prompts";
import { globalPaths, projectPaths } from "../utils/paths.js";
import {
  readExtensionsJson,
  writeExtensionsJson,
} from "../services/project-manager.js";
import * as log from "../utils/logger.js";
import { addExtensionHooks, removeExtensionHooks } from "./hook-file-generator.js";

export interface InstallOptions {
  projectDir: string;
  name: string;
  version: string;
  repository: string;
  marketplace: string;
  skipMount?: boolean;
  yes?: boolean;
}

export interface InstallResult {
  success: boolean;
  error?: string;
  extensionDir?: string;
}

interface ManifestLike {
  name?: unknown;
  version?: unknown;
  sdkVersion?: unknown;
  permissions?: Record<string, unknown>;
  hooks?: { events?: string[] };
  skills?: Array<{ name?: string; file?: string }>;
}

function looksLikeTag(version: string): boolean {
  return version.includes(".");
}

export async function downloadExtension(
  name: string,
  version: string,
  repository: string,
): Promise<string> {
  const destDir = join(globalPaths().extensionsDir, name, version);

  if (existsSync(destDir)) {
    return destDir;
  }

  mkdirSync(destDir, { recursive: true });

  const args = looksLikeTag(version)
    ? ["clone", "--depth=1", "--branch", version, repository, destDir]
    : ["clone", "--depth=1", repository, destDir];

  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const result = spawnSync("git", args, { stdio: "inherit" });

  if (result.status !== 0) {
    throw new Error("git clone failed");
  }

  return destDir;
}

export function formatPermissions(perms: Record<string, unknown> | undefined): string {
  if (!perms || Object.keys(perms).length === 0) {
    return "  (none)";
  }
  const lines: string[] = [];
  for (const [key, value] of Object.entries(perms)) {
    if (value) {
      lines.push(`  - ${key}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : "  (none)";
}

function readManifest(extensionDir: string): ManifestLike {
  const manifestPath = join(extensionDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${extensionDir}`);
  }
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestLike;
  if (!raw.name || !raw.version || !raw.sdkVersion) {
    throw new Error("manifest.json missing required fields: name, version, sdkVersion");
  }
  return raw;
}


function resolveSkillSourcePath(extensionDir: string, skillName: string): string | null {
  const pathA = join(extensionDir, "skills", `${skillName}.md`);
  const pathB = join(extensionDir, "skills", skillName, "SKILL.md");
  if (existsSync(pathA)) return pathA;
  if (existsSync(pathB)) return pathB;
  return null;
}

function copySkills(
  projectDir: string,
  extensionDir: string,
  skills: ManifestLike["skills"],
): void {
  if (!Array.isArray(skills) || skills.length === 0) return;

  const paths = projectPaths(projectDir);

  for (const skill of skills) {
    const skillName = typeof skill.name === "string" ? skill.name : null;
    if (!skillName) continue;

    const sourcePath = resolveSkillSourcePath(extensionDir, skillName);
    if (!sourcePath) continue;

    const destDir = join(paths.skillsDir, skillName);
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "SKILL.md"), readFileSync(sourcePath, "utf8"), "utf8");
  }
}

export async function validateAndInstall(
  options: InstallOptions,
  interactive: boolean,
): Promise<InstallResult> {
  const { projectDir, name, version, repository, marketplace, yes } = options;

  const spin = log.spinner(`Downloading ${name}@${version}...`);

  let extensionDir: string;
  try {
    extensionDir = await downloadExtension(name, version, repository);
    spin.stop(`Downloaded ${name}@${version}`);
  } catch (err) {
    spin.stop();
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }

  let manifest: ManifestLike;
  try {
    manifest = readManifest(extensionDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Manifest validation failed: ${msg}` };
  }

  if (interactive) {
    const permsText = formatPermissions(manifest.permissions);
    log.info(`Permissions requested by ${name}:\n${permsText}`);

    if (!yes) {
      const confirmed = await clack.confirm({ message: "Accept these permissions?" });
      if (clack.isCancel(confirmed) || !confirmed) {
        return { success: false, error: "Installation cancelled by user" };
      }
    }
  }

  if (manifest.hooks?.events?.length) {
    addExtensionHooks(projectDir, name, manifest.hooks.events, name);
  }
  copySkills(projectDir, extensionDir, manifest.skills);

  const extJson = readExtensionsJson(projectDir) ?? { extensions: [] };
  const existingIdx = extJson.extensions.findIndex((e) => e.name === name);
  const entry = {
    name,
    version,
    enabled: true,
    source: repository,
    marketplace,
    settings: {},
  };

  if (existingIdx >= 0) {
    extJson.extensions[existingIdx] = entry;
  } else {
    extJson.extensions.push(entry);
  }

  writeExtensionsJson(projectDir, extJson);

  return { success: true, extensionDir };
}

export function uninstallExtension(projectDir: string, name: string): void {
  const extJson = readExtensionsJson(projectDir);
  if (!extJson) return;

  extJson.extensions = extJson.extensions.filter((e) => e.name !== name);
  writeExtensionsJson(projectDir, extJson);

  removeExtensionHooks(projectDir, name);

  const paths = projectPaths(projectDir);

  const skillDir = join(paths.skillsDir, name);
  if (existsSync(skillDir)) {
    try {
      rmSync(skillDir, { recursive: true });
    } catch {
      // Non-fatal — skill directory removal failed
    }
  }
}

export function installFromLocal(
  name: string,
  version: string,
  localPath: string,
): string {
  const destDir = join(globalPaths().extensionsDir, name, version);
  mkdirSync(destDir, { recursive: true });
  cpSync(localPath, destDir, { recursive: true });
  return destDir;
}
