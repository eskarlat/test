/**
 * Centralised URL constants and utilities for RenRe Kit.
 *
 * To support a self-hosted or GitHub Enterprise instance add its hostname
 * to GITHUB_HOSTNAMES. The array is intentionally `readonly` — only change
 * it here, not at call sites.
 *
 * Examples of additional hostnames:
 *   "github.example.com"      // GitHub Enterprise Server (self-hosted)
 *   "github.acme.org"         // GitHub Enterprise Cloud custom domain
 */

/** Official marketplace URL — change here to point at a different default. */
export const DEFAULT_MARKETPLACE_URL = "https://marketplace.renre-kit.dev";

/**
 * Base URL for JSON Schema `$schema` fields.
 * Append "/project.json", "/extensions.json", "/hooks.json", etc.
 */
export const SCHEMA_BASE_URL = "https://renre-kit.dev/schemas";

/**
 * Known GitHub hostnames. Exact-match only (no wildcard subdomains).
 * Add your self-hosted or enterprise GitHub hostname here.
 */
export const GITHUB_HOSTNAMES: readonly string[] = [
  "github.com",
];

/**
 * Returns true if `url` points to a known GitHub instance.
 * Uses the WHATWG URL parser so it behaves consistently on all platforms
 * (Windows, Linux, macOS) regardless of path separators.
 */
export function isGitHubUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return (GITHUB_HOSTNAMES as string[]).includes(hostname);
  } catch {
    return false;
  }
}

/**
 * Builds the fetch URL for a marketplace index from a repository base URL.
 *
 * - GitHub repositories → `{url}/raw/main/.renre-kit/marketplace.json`
 * - All other hosts     → `{url}/marketplace.json`
 *
 * Trailing slashes are stripped before appending the path.
 */
function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

export function buildMarketplaceFetchUrl(repoUrl: string): string {
  const base = stripTrailingSlashes(repoUrl);
  if (isGitHubUrl(base)) {
    return `${base}/raw/main/.renre-kit/marketplace.json`;
  }
  return `${base}/marketplace.json`;
}

/**
 * Returns true if the value looks like a local filesystem path
 * rather than a URL. Matches absolute paths (/, ~/, C:\) and
 * explicit file:// URIs.
 */
export function isLocalPath(value: string): boolean {
  if (value.startsWith("file://")) return true;
  if (value.startsWith("/") || value.startsWith("~")) return true;
  // Windows absolute path: C:\ or D:/
  if (/^[A-Za-z]:[/\\]/.test(value)) return true;
  return false;
}
