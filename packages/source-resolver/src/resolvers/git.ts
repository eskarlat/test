import { existsSync } from "node:fs";
import type { SourceResolver, ParsedSource, ResolvedExtension } from "../types.js";
import { cloneAndCopy, resolveLatestTag } from "../download/clone-and-copy.js";
import { toSourceUri } from "../parse.js";

/**
 * Resolves and downloads extensions from git repositories.
 * Handles both `github:` and `git:` schemes.
 */
export class GitResolver implements SourceResolver {
  readonly scheme = "github" as const;

  async resolve(parsed: ParsedSource): Promise<ResolvedExtension> {
    const cloneUrl = this.buildCloneUrl(parsed);
    let cloneRef = parsed.ref;

    // Resolve "latest" to a concrete tag
    if (cloneRef === "latest") {
      const tag = resolveLatestTag(cloneUrl);
      if (tag) {
        cloneRef = tag;
      } else {
        // No semver tags found — clone HEAD
        cloneRef = undefined;
      }
    }

    // Derive version from ref (strip leading 'v')
    const version = cloneRef
      ? (cloneRef.startsWith("v") ? cloneRef.slice(1) : cloneRef)
      : "0.0.0-HEAD";

    return {
      name: parsed.name,
      version,
      source: parsed,
      cloneUrl,
      cloneRef,
      subpath: parsed.subpath,
    };
  }

  async download(resolved: ResolvedExtension, destDir: string): Promise<string> {
    // Check cache first
    if (existsSync(destDir)) {
      return destDir;
    }

    return cloneAndCopy({
      cloneUrl: resolved.cloneUrl,
      ref: resolved.cloneRef,
      subpath: resolved.subpath,
      destDir,
      sourceUri: toSourceUri(resolved.source),
    });
  }

  private buildCloneUrl(parsed: ParsedSource): string {
    if (parsed.scheme === "git" && parsed.gitUrl) {
      return parsed.gitUrl;
    }

    if (parsed.owner && parsed.repo) {
      return `https://github.com/${parsed.owner}/${parsed.repo}.git`;
    }

    throw new Error("Cannot build clone URL: missing owner/repo or gitUrl");
  }
}
