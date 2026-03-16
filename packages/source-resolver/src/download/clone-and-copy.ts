import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  cpSync,
  rmSync,
  readdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SourceMetadata } from "../types.js";

/**
 * Clone a git repo to a temp directory, copy the relevant files to the
 * destination, and clean up the temp directory.
 *
 * If `subpath` is specified, only that subdirectory is copied.
 * The `.git` directory is never included in the output.
 */
export function cloneAndCopy(opts: {
  cloneUrl: string;
  ref?: string;
  subpath?: string;
  destDir: string;
  sourceUri: string;
}): string {
  const { cloneUrl, ref, subpath, destDir, sourceUri } = opts;

  // Create temp directory for the clone
  const tempDir = mkdtempSync(join(tmpdir(), "renre-kit-dl-"));

  try {
    // Build git clone args
    const args = ["clone", "--depth=1"];
    if (ref && ref !== "latest") {
      args.push("--branch", ref);
    }
    args.push(cloneUrl, tempDir);

    // eslint-disable-next-line sonarjs/no-os-command-from-path
    const result = spawnSync("git", args, {
      stdio: "pipe",
      encoding: "utf8",
      timeout: 120_000,
    });

    if (result.status !== 0) {
      const stderr = result.stderr?.trim() ?? "";
      throw new Error(`git clone failed (exit ${result.status ?? "null"}): ${stderr}`);
    }

    // Determine source directory (full clone or subpath)
    const sourceDir = subpath ? join(tempDir, subpath) : tempDir;

    if (subpath && !existsSync(sourceDir)) {
      throw new Error(`Subpath "${subpath}" does not exist in the cloned repository`);
    }

    // Copy to destination, excluding .git
    mkdirSync(destDir, { recursive: true });
    copyDirExcludingGit(sourceDir, destDir);

    // Read commit SHA from the clone
    const commitSha = readCommitSha(tempDir);

    // Write source metadata
    const metadata: SourceMetadata = {
      uri: sourceUri,
      downloadedAt: new Date().toISOString(),
      strategy: "git-clone",
      commitSha,
    };
    writeFileSync(
      join(destDir, "_source.json"),
      JSON.stringify(metadata, null, 2) + "\n",
      "utf8",
    );

    return destDir;
  } finally {
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Non-fatal — temp cleanup failure
    }
  }
}

/**
 * Copy directory contents, skipping .git directories.
 */
function copyDirExcludingGit(src: string, dest: string): void {
  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git") continue;

    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      cpSync(srcPath, destPath, { recursive: true });
    } else {
      cpSync(srcPath, destPath);
    }
  }
}

/**
 * Read the HEAD commit SHA from a cloned repository.
 */
function readCommitSha(repoDir: string): string | undefined {
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoDir,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  return undefined;
}

/**
 * List semver tags from a remote git repository without cloning.
 * Returns tags sorted by semver (highest first).
 */
export function listRemoteTags(cloneUrl: string): string[] {
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const result = spawnSync("git", ["ls-remote", "--tags", cloneUrl], {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 30_000,
  });

  if (result.status !== 0) {
    return [];
  }

  const lines = result.stdout.split("\n").filter(Boolean);
  const tags: string[] = [];

  for (const line of lines) {
    // Format: <sha>\trefs/tags/<tagname>
    const match = /refs\/tags\/(.+)$/.exec(line);
    if (!match?.[1]) continue;

    // Skip dereferenced tags (^{})
    const tag = match[1];
    if (tag.endsWith("^{}")) continue;

    tags.push(tag);
  }

  // Sort by semver (strip leading 'v' for comparison), highest first
  return tags.sort((a, b) => {
    const aNorm = a.startsWith("v") ? a.slice(1) : a;
    const bNorm = b.startsWith("v") ? b.slice(1) : b;
    return compareSemver(bNorm, aNorm);
  });
}

/**
 * Resolve "latest" to the highest semver tag from a remote repository.
 * Returns the tag string (e.g., "v1.2.0") or undefined if no semver tags found.
 */
export function resolveLatestTag(cloneUrl: string): string | undefined {
  const tags = listRemoteTags(cloneUrl);
  // Find the first tag that looks like semver
  for (const tag of tags) {
    const norm = tag.startsWith("v") ? tag.slice(1) : tag;
    if (isSemverLike(norm)) return tag;
  }
  return undefined;
}

/**
 * Check if a string looks like a semver version.
 */
function isSemverLike(s: string): boolean {
  return /^\d+\.\d+\.\d+/.test(s);
}

/**
 * Simple semver comparison. Returns negative if a < b, positive if a > b, 0 if equal.
 */
function compareSemver(a: string, b: string): number {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);
  const len = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < len; i++) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;
    if (aVal !== bVal) return aVal - bVal;
  }
  return 0;
}
