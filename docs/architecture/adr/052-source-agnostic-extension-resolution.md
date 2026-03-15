# ADR-052: Source-Agnostic Extension Resolution

## Status
Accepted

## Context
The extension installation system (ADR-005) only supports two paths: marketplace lookup → `git clone`, or `--local` copy. This creates several blockers:

- **Private GitHub repos don't work** — `git clone` and marketplace `fetch()` have no authentication mechanism
- **Monorepo extensions are broken** — `marketplace.json` has a `path` field but `downloadExtension()` ignores it, always cloning the full repo
- **`git clone` pollutes cache** — clones directly into `~/.renre-kit/extensions/{name}/{version}/`, leaving the `.git` directory behind
- **No direct GitHub install** — users can't install from a repo URL without first registering it in a marketplace index
- **Code duplication** — `downloadExtension()` is copy-pasted between CLI (`extension-installer.ts`) and worker-service (`marketplace.ts`)
- **GitHub Enterprise not configurable** — `GITHUB_HOSTNAMES` is hardcoded in `urls.ts`

**Supersedes**: Parts of ADR-005 (marketplace fetched via HTTP). ADR-005's core decision (marketplace is a JSON file in a GitHub repo) remains valid.

## Decision

### 1. Extension Source URI Scheme

Introduce a canonical URI format that encodes source type, location, subpath, and version into a single string. This URI is stored in `extensions.json` and is the primary input to the resolver pipeline.

| Scheme | Format | Example |
|--------|--------|---------|
| marketplace | `marketplace:<marketplace>/<name>@<version>` | `marketplace:official/jira-plugin@1.0.0` |
| github | `github:<owner>/<repo>@<ref>` | `github:acme/jira-ext@v1.0.0` |
| github+path | `github:<owner>/<repo>/<path>@<ref>` | `github:acme/monorepo/packages/jira@v1.0.0` |
| git | `git:<any-git-url>@<ref>` | `git:git@gitlab.com:org/repo.git@v1.0.0` |
| local | `local:<absolute-path>` | `local:/home/user/dev/my-ext` |
| local+link | `local+link:<absolute-path>` | `local+link:/home/user/dev/my-ext` |

Shorthand expansion rules preserve the existing CLI ergonomics:

| User types | Expanded to |
|------------|-------------|
| `jira-plugin` | `marketplace:*/jira-plugin@latest` |
| `official/jira-plugin@1.0.0` | `marketplace:official/jira-plugin@1.0.0` |
| `github:acme/repo` | `github:acme/repo@latest` |
| `github:acme/monorepo/packages/ext@v1` | `github:acme/monorepo/packages/ext@v1` |
| `./path` or `/path` | `local:<absolute-path>` |
| `./path --link` | `local+link:<absolute-path>` |

### 2. Shared Resolver Package: `packages/source-resolver/`

A new monorepo package that both CLI and worker-service import from, eliminating the duplicated `downloadExtension()` function.

```
packages/source-resolver/
  src/
    index.ts                    # ResolverRegistry (main entry point)
    parse.ts                    # URI parser + shorthand expansion
    types.ts                    # ParsedSource, ResolvedExtension, DownloadStrategy
    resolvers/
      marketplace.ts            # Clones marketplace repo, reads index, delegates to GitResolver
      git.ts                    # git clone to temp → copy (with subpath support)
      local.ts                  # Copy or symlink (--link support)
    download/
      clone-and-copy.ts         # git clone --depth=1 → copy subpath → cleanup temp
```

Resolver interface:

```typescript
interface SourceResolver {
  scheme: string;
  resolve(parsed: ParsedSource): Promise<ResolvedExtension>;
  download(resolved: ResolvedExtension, destDir: string): Promise<string>;
}
```

Pipeline: `input string → parse() → ParsedSource → resolve() → ResolvedExtension → download() → cached path → validate manifest`

### 3. Zero-Config Authentication via Git

All downloads use `git clone`, which inherits the user's existing git credentials automatically (SSH keys, credential helpers, VPN access, `.netrc`, etc.). No custom auth layer. No `renre-kit auth` commands. Users manage git credentials with their existing tools (`gh auth login`, `git credential-manager`, SSH config, etc.).

Private GitHub Enterprise instances accessible over VPN work without any token configuration in RenRe Kit.

### 4. Clone to Temp → Copy

```
1. git clone --depth=1 [--branch <tag>] <repo-url> /tmp/renre-kit-dl-XXXXX
2. If subpath specified: copy only /tmp/.../subpath/* to cache dir
   If no subpath: copy entire clone to cache dir (excluding .git)
3. Remove /tmp/renre-kit-dl-XXXXX
```

This approach:
- Delegates auth to git natively
- Keeps `.git` out of the cache
- Supports subpath extraction trivially (just copy a subdirectory)
- Works identically for github.com, GitHub Enterprise, GitLab, Bitbucket, and any git host

### 5. Local Symlink Mode (`--link`)

For extension development, `--link` creates a symlink instead of copying:

```bash
renre-kit marketplace add --local ./my-extension --link
```

Creates: `~/.renre-kit/extensions/{name}/{version}/ → /abs/path/my-extension`

Changes to the local extension are reflected immediately without reinstall. On Windows, falls back to directory junctions if symlinks require elevated permissions.

### 6. Version Resolution for Direct Git Installs

For `github:owner/repo@latest`:
1. `git ls-remote --tags <repo-url>` → filter semver tags → pick highest
2. Clone at that tag, copy to cache
3. Read `manifest.json` → use `manifest.version` as canonical version for caching

Any repo with a valid `manifest.json` is directly installable without marketplace registration (self-describing repos).

### 7. Private Marketplace Index Fetching

Marketplace repos are cloned via git (not fetched via HTTP), then `marketplace.json` is read from the local clone. This makes private marketplace repos work automatically through git credentials. Cache with 1h TTL, same as today.

### 8. Marketplace Schema Update

The `marketplace.json` schema replaces `repository` + `path` with a single `source` URI field:

```json
{
  "name": "jira-plugin",
  "version": "1.2.0",
  "description": "Jira integration",
  "source": "github:acme/jira-ext/packages/jira@v1.2.0",
  "tags": ["jira"]
}
```

### 9. Configurable GitHub Hosts

`~/.renre-kit/config.json` gains a `githubHosts` array:

```json
{
  "githubHosts": ["github.com", "github.enterprise.example.com"]
}
```

`isGitHubUrl()` reads from config instead of the hardcoded `GITHUB_HOSTNAMES` array. This is only needed for marketplace index URL path construction.

### 10. Cache Metadata

A `_source.json` file is written alongside cached extensions:

```json
{
  "uri": "github:acme/repo@v1.0.0",
  "downloadedAt": "2026-03-15T10:00:00Z",
  "strategy": "git-clone",
  "commitSha": "abc123def"
}
```

## Consequences

### Positive
- Extensions installable from any git host (GitHub, GitLab, Bitbucket, self-hosted)
- Private repos work via VPN + existing git credentials — zero configuration
- Monorepo extensions are first-class citizens (subpath extraction)
- `--link` mode enables fast extension development iteration
- Shared resolver package eliminates CLI/worker code duplication
- URI scheme is extensible (new schemes can be added without CLI flag changes)

### Negative
- `git clone --depth=1` still downloads more data than a tarball API would
- Marketplace index fetch now requires a full git clone (heavier than HTTP fetch for public repos)
- URI parsing adds complexity to the install path

### Mitigations
- `--depth=1` minimizes clone size (no history)
- Marketplace clone is cached with TTL — typically one clone per hour
- For public repos where HTTP fetch worked fine, the git clone overhead is small (~seconds)
- URI parser is well-tested with comprehensive edge case coverage

## Related
- ADR-005: GitHub-Based Marketplace (partially superseded — HTTP fetch replaced with git clone)
- ADR-011: Extension Version Pinning (unchanged — version pinning continues to work)
- ADR-016: Extension Upgrade Flow (unchanged — upgrade uses the new resolver)
- ADR-020: Manifest Validation (unchanged — validation still runs after download)
