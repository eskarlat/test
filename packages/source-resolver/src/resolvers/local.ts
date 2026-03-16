import {
  existsSync,
  readFileSync,
  mkdirSync,
  cpSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { SourceResolver, ParsedSource, ResolvedExtension, SourceMetadata } from "../types.js";
import { toSourceUri } from "../parse.js";

/**
 * Resolves and installs extensions from local filesystem paths.
 * Supports copy mode (local:) and symlink mode (local+link:).
 */
export class LocalResolver implements SourceResolver {
  readonly scheme = "local" as const;

  async resolve(parsed: ParsedSource): Promise<ResolvedExtension> {
    const localPath = parsed.localPath;
    if (!localPath) {
      throw new Error("Local resolver requires a filesystem path");
    }

    if (!existsSync(localPath)) {
      throw new Error(`Local extension path does not exist: ${localPath}`);
    }

    // Read manifest to get name and version
    const manifestPath = join(localPath, "manifest.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`manifest.json not found in ${localPath}`);
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: string;
      version?: string;
    };
    const name = typeof manifest.name === "string" ? manifest.name : parsed.name;
    const version = typeof manifest.version === "string" ? manifest.version : "0.0.0-local";

    return {
      name,
      version,
      source: parsed,
      cloneUrl: localPath,
    };
  }

  async download(resolved: ResolvedExtension, destDir: string): Promise<string> {
    const localPath = resolved.source.localPath;
    if (!localPath) {
      throw new Error("Local resolver requires a filesystem path");
    }

    const isLink = resolved.source.scheme === "local+link";

    if (isLink) {
      return this.createSymlink(localPath, destDir, resolved);
    }
    return this.copyExtension(localPath, destDir, resolved);
  }

  private createSymlink(
    localPath: string,
    destDir: string,
    resolved: ResolvedExtension,
  ): string {
    // Create parent directory (the symlink target is the destDir itself)
    const parentDir = join(destDir, "..");
    mkdirSync(parentDir, { recursive: true });

    try {
      symlinkSync(localPath, destDir, "dir");
    } catch (err: unknown) {
      // On Windows, symlinks may require elevated permissions.
      // Fall back to directory junctions.
      if (isEperm(err)) {
        try {
          symlinkSync(localPath, destDir, "junction");
        } catch {
          throw new Error(
            `Failed to create symlink to ${localPath}. On Windows, enable Developer Mode or run as administrator.`,
          );
        }
      } else {
        throw err;
      }
    }

    // Write source metadata (in the parent, since destDir is a symlink)
    const metadata: SourceMetadata = {
      uri: toSourceUri(resolved.source),
      downloadedAt: new Date().toISOString(),
      strategy: "local-symlink",
    };
    writeFileSync(
      join(parentDir, "_source.json"),
      JSON.stringify(metadata, null, 2) + "\n",
      "utf8",
    );

    return destDir;
  }

  private copyExtension(
    localPath: string,
    destDir: string,
    resolved: ResolvedExtension,
  ): string {
    mkdirSync(destDir, { recursive: true });
    cpSync(localPath, destDir, { recursive: true });

    const metadata: SourceMetadata = {
      uri: toSourceUri(resolved.source),
      downloadedAt: new Date().toISOString(),
      strategy: "local-copy",
    };
    writeFileSync(
      join(destDir, "_source.json"),
      JSON.stringify(metadata, null, 2) + "\n",
      "utf8",
    );

    return destDir;
  }
}

function isEperm(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "EPERM";
}
