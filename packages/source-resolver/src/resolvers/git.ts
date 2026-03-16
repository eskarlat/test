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
    let cloneRef: string | undefined = parsed.ref;

    // Resolve "latest" to a concrete tag
    if (cloneRef === "latest") {
      const tag = resolveLatestTag(cloneUrl);
      cloneRef = tag ?? undefined;
    }

    // Derive version from ref (strip leading 'v')
    const version = cloneRef
      ? (cloneRef.startsWith("v") ? cloneRef.slice(1) : cloneRef)
      : "0.0.0-HEAD";

    const result: ResolvedExtension = {
      name: parsed.name,
      version,
      source: parsed,
      cloneUrl,
    };
    if (cloneRef !== undefined) result.cloneRef = cloneRef;
    if (parsed.subpath !== undefined) result.subpath = parsed.subpath;
    return result;
  }

  async download(resolved: ResolvedExtension, destDir: string): Promise<string> {
    // Check cache first
    if (existsSync(destDir)) {
      return destDir;
    }

    const opts: { cloneUrl: string; destDir: string; sourceUri: string; ref?: string; subpath?: string } = {
      cloneUrl: resolved.cloneUrl,
      destDir,
      sourceUri: toSourceUri(resolved.source),
    };
    if (resolved.cloneRef !== undefined) opts.ref = resolved.cloneRef;
    if (resolved.subpath !== undefined) opts.subpath = resolved.subpath;
    return cloneAndCopy(opts);
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
