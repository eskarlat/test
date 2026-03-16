import { resolve } from "node:path";
import type { ParsedSource, SourceScheme } from "./types.js";

const SCHEME_PREFIXES: readonly SourceScheme[] = [
  "marketplace",
  "github",
  "git",
  "local+link",
  "local",
];

/**
 * Split a ref (version/tag) from the end of a string.
 * The last `@` that is not at position 0 is the delimiter.
 *
 * "jira-plugin@1.0.0" → ["jira-plugin", "1.0.0"]
 * "acme/repo@v1"      → ["acme/repo", "v1"]
 * "acme/repo"          → ["acme/repo", "latest"]
 */
function splitRef(input: string): [body: string, ref: string] {
  const atIdx = input.lastIndexOf("@");
  if (atIdx > 0) {
    return [input.slice(0, atIdx), input.slice(atIdx + 1)];
  }
  return [input, "latest"];
}

/**
 * Parse an extension source URI (or shorthand) into a structured ParsedSource.
 *
 * Supported formats:
 *   marketplace:official/jira-plugin@1.0.0
 *   github:acme/repo@v1.0.0
 *   github:acme/repo/packages/ext@v1.0.0
 *   git:git@gitlab.com:org/repo.git@v1.0.0
 *   git:https://gitlab.com/org/repo@v1.0.0
 *   local:/absolute/path
 *   local+link:/absolute/path
 *
 * Shorthand:
 *   jira-plugin             → marketplace:asterisk/jira-plugin (latest)
 *   official/jira-plugin    → marketplace:official/jira-plugin (latest)
 *   ./path or /path         → local:absolute-path
 */
export function parseSourceUri(input: string): ParsedSource {
  const trimmed = input.trim();

  if (trimmed === "") {
    throw new Error("Extension source cannot be empty");
  }

  // Check for explicit scheme prefix
  for (const scheme of SCHEME_PREFIXES) {
    const prefix = `${scheme}:`;
    if (trimmed.startsWith(prefix)) {
      const body = trimmed.slice(prefix.length);
      return parseWithScheme(scheme, body);
    }
  }

  // Shorthand expansion — no explicit scheme
  return parseShorthand(trimmed);
}

function parseWithScheme(scheme: SourceScheme, body: string): ParsedSource {
  switch (scheme) {
    case "marketplace":
      return parseMarketplaceBody(body);
    case "github":
      return parseGitHubBody(body);
    case "git":
      return parseGitBody(body);
    case "local":
      return parseLocalBody(body, false);
    case "local+link":
      return parseLocalBody(body, true);
  }
}

function parseMarketplaceBody(body: string): ParsedSource {
  const [nameBody, ref] = splitRef(body);

  const slashIdx = nameBody.indexOf("/");
  if (slashIdx > 0) {
    const marketplace = nameBody.slice(0, slashIdx);
    const name = nameBody.slice(slashIdx + 1);
    if (!name) throw new Error(`Invalid marketplace URI: missing extension name`);
    return { scheme: "marketplace", marketplace, name, ref };
  }

  // No marketplace prefix → search all
  return { scheme: "marketplace", marketplace: "*", name: nameBody, ref };
}

function parseGitHubBody(body: string): ParsedSource {
  const [pathBody, ref] = splitRef(body);
  const segments = pathBody.split("/").filter(Boolean);

  if (segments.length < 2) {
    throw new Error(`Invalid github URI: expected at least owner/repo, got "${pathBody}"`);
  }

  const owner = segments[0]!;
  const repo = segments[1]!;
  const subpath = segments.length > 2 ? segments.slice(2).join("/") : undefined;
  const name = subpath ? segments[segments.length - 1]! : repo;

  const result: ParsedSource = { scheme: "github", owner, repo, name, ref };
  if (subpath !== undefined) result.subpath = subpath;
  return result;
}

function parseGitBody(body: string): ParsedSource {
  // git URLs can contain @ (e.g., git@github.com:...), so we need careful ref splitting.
  // Strategy: if the body ends with @<semver-like> or @<tag>, split there.
  // Otherwise, treat the entire body as the URL with ref="latest".
  const [gitUrl, ref] = splitGitRef(body);

  // Derive name from the URL: last path segment, minus .git suffix
  const cleaned = gitUrl.replace(/\.git$/, "").replace(/:/, "/");
  const segments = cleaned.split("/").filter(Boolean);
  const name = segments[segments.length - 1] ?? "unknown";

  return { scheme: "git", gitUrl, name, ref };
}

/**
 * Split a git ref from a git URL. Git URLs may contain @ in the host part
 * (e.g., git@github.com:org/repo.git), so we can't just use lastIndexOf("@").
 *
 * Strategy: look for the last @ that is preceded by .git or a path segment,
 * not by a hostname. If the text after the last @ looks like a version/tag, split there.
 */
function splitGitRef(input: string): [url: string, ref: string] {
  const lastAt = input.lastIndexOf("@");
  if (lastAt <= 0) return [input, "latest"];

  const afterAt = input.slice(lastAt + 1);
  const beforeAt = input.slice(0, lastAt);

  // If afterAt looks like a version (starts with v or digit, or is a word like "main"),
  // and beforeAt looks like it ends a URL (ends with .git, /, or alphanumeric), split.
  if (/^[v\d]/.test(afterAt) || /^(latest|main|master|HEAD)$/i.test(afterAt)) {
    // Make sure beforeAt is actually a URL, not just the user@ part
    if (beforeAt.includes("/") || beforeAt.includes(":")) {
      // Check it's not just "git@hostname" — must have a path
      const colonIdx = beforeAt.indexOf(":");
      const slashIdx = beforeAt.indexOf("/");
      if (slashIdx > 0 || (colonIdx > 0 && beforeAt.slice(colonIdx + 1).includes("/"))) {
        return [beforeAt, afterAt];
      }
    }
  }

  return [input, "latest"];
}

function parseLocalBody(body: string, link: boolean): ParsedSource {
  const absPath = resolve(body);
  const segments = absPath.split("/").filter(Boolean);
  const name = segments[segments.length - 1] ?? "unknown";
  const scheme: SourceScheme = link ? "local+link" : "local";
  return { scheme, localPath: absPath, name, ref: "local" };
}

function parseShorthand(input: string): ParsedSource {
  // Local path: starts with /, ./, ../, or ~
  if (input.startsWith("/") || input.startsWith("./") || input.startsWith("../") || input.startsWith("~")) {
    return parseLocalBody(input, false);
  }

  // Windows absolute path
  if (/^[A-Za-z]:[/\\]/.test(input)) {
    return parseLocalBody(input, false);
  }

  const [body, ref] = splitRef(input);

  // Contains "/" → could be marketplace/name or github owner/repo
  if (body.includes("/")) {
    const segments = body.split("/").filter(Boolean);
    if (segments.length === 2) {
      // Two segments: ambiguous between marketplace/name and github owner/repo.
      // Default to marketplace (as per existing behavior).
      return { scheme: "marketplace", marketplace: segments[0]!, name: segments[1]!, ref };
    }
    if (segments.length >= 3) {
      // Three+ segments: github:owner/repo/subpath
      const owner = segments[0]!;
      const repo = segments[1]!;
      const subpath = segments.slice(2).join("/");
      const name = segments[segments.length - 1]!;
      return { scheme: "github", owner, repo, subpath, name, ref };
    }
  }

  // Bare name → marketplace search all
  return { scheme: "marketplace", marketplace: "*", name: body, ref };
}

/**
 * Serialize a ParsedSource back to a canonical URI string.
 */
export function toSourceUri(parsed: ParsedSource): string {
  switch (parsed.scheme) {
    case "marketplace": {
      const mp = parsed.marketplace === "*" ? "" : `${parsed.marketplace}/`;
      const ref = parsed.ref === "latest" ? "" : `@${parsed.ref}`;
      return `marketplace:${mp}${parsed.name}${ref}`;
    }
    case "github": {
      const path = parsed.subpath ? `/${parsed.subpath}` : "";
      const ref = parsed.ref === "latest" ? "" : `@${parsed.ref}`;
      return `github:${parsed.owner}/${parsed.repo}${path}${ref}`;
    }
    case "git": {
      const ref = parsed.ref === "latest" ? "" : `@${parsed.ref}`;
      return `git:${parsed.gitUrl ?? ""}${ref}`;
    }
    case "local":
      return `local:${parsed.localPath ?? ""}`;
    case "local+link":
      return `local+link:${parsed.localPath ?? ""}`;
  }
}
