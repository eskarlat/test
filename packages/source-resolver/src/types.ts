/**
 * Supported source URI schemes for extension resolution.
 */
export type SourceScheme = "marketplace" | "github" | "git" | "local" | "local+link";

/**
 * Parsed representation of an extension source URI.
 *
 * Examples:
 *   marketplace:official/jira-plugin@1.0.0
 *   github:acme/repo/packages/ext@v1.0.0
 *   git:git@gitlab.com:org/repo.git@v1.0.0
 *   local:/home/user/dev/my-ext
 *   local+link:/home/user/dev/my-ext
 */
export interface ParsedSource {
  scheme: SourceScheme;

  /** Marketplace name (e.g., "official"). "*" means search all marketplaces. */
  marketplace?: string;

  /** GitHub owner (e.g., "acme"). Used for github: scheme. */
  owner?: string;

  /** GitHub repository name (e.g., "repo"). Used for github: scheme. */
  repo?: string;

  /** Subdirectory path within the repo (e.g., "packages/ext"). */
  subpath?: string;

  /** Raw git URL for git: scheme (e.g., "git@gitlab.com:org/repo.git"). */
  gitUrl?: string;

  /** Local filesystem path for local: and local+link: schemes. */
  localPath?: string;

  /** Extension name (derived from last path segment, package name, or explicit). */
  name: string;

  /** Version/tag/ref. "latest" if not specified. */
  ref: string;
}

/**
 * Result of resolving an extension source to a concrete downloadable target.
 */
export interface ResolvedExtension {
  name: string;
  version: string;
  source: ParsedSource;
  /** The git clone URL or local path to download from. */
  cloneUrl: string;
  /** Git ref (tag/branch/sha) to clone at. Undefined for local sources. */
  cloneRef?: string;
  /** Subpath within the cloned repo to extract. */
  subpath?: string;
}

/**
 * Metadata written to _source.json in the cache directory.
 */
export interface SourceMetadata {
  uri: string;
  downloadedAt: string;
  strategy: "git-clone" | "local-copy" | "local-symlink";
  commitSha?: string;
}

/**
 * Marketplace index entry — a single extension listed in marketplace.json.
 */
export interface MarketplaceEntry {
  name: string;
  version: string;
  description: string;
  source: string;
  tags?: string[];
}

/**
 * Marketplace index — the full marketplace.json content.
 */
export interface MarketplaceIndex {
  name: string;
  extensions: MarketplaceEntry[];
}

/**
 * Marketplace configuration — a registered marketplace source.
 */
export interface MarketplaceConfig {
  name: string;
  url: string;
  default?: boolean;
}

/**
 * Interface implemented by each source resolver.
 */
export interface SourceResolver {
  readonly scheme: SourceScheme;
  resolve(parsed: ParsedSource): Promise<ResolvedExtension>;
  download(resolved: ResolvedExtension, destDir: string): Promise<string>;
}
