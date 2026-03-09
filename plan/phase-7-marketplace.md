# Phase 7 — Marketplace

## Goal
Implement the full marketplace system: `add`, `remove`, `search`, `upgrade`, `list`, `register`, `unregister`. Support multi-marketplace, version pinning, and the `[marketplace/]extension[@version]` install pattern.

## Reference
- ADR-005: GitHub-Based Marketplace
- ADR-011: Extension Version Pinning
- ADR-015: Repository Structure (marketplace.json)
- ADR-016: Extension Upgrade Flow
- ADR-017: Extension Permissions (install prompt)
- ADR-020: Manifest Validation (on install)
- SEQ: install-extension, uninstall-extension

## Dependencies
- Phase 2 (CLI core)
- Phase 4 (extension system — mount/unmount, validation)
- Phase 5 (Vault — settings resolution)

## Tasks

### 7.1 Marketplace client service
- [ ] Fetch `marketplace.json` from GitHub repo (raw content URL)
- [ ] Parse marketplace metadata per ADR-005 schema: `{ name, version, description, repository, tags }`
- [ ] Cache to `~/.renre-kit/marketplace-cache.json` with TTL (1 hour)
- [ ] Support multiple registered marketplaces — merge results
- [ ] Search: filter extensions by name/description/tags across all marketplaces
- [ ] Future: GitHub API token support for higher rate limits (ADR-005 mitigation, not in current scope)

### 7.2 Extension installer service
- [ ] Download extension from GitHub repo using `simple-git` clone (ADR-005 primary method) or archive download (plan optimization)
- [ ] Save to `~/.renre-kit/extensions/{name}/{version}/`
- [ ] Run manifest validation (Phase 4 validator) — includes MCP command allowlist check (ADR-008)
- [ ] On validation failure: cleanup downloaded files, abort
- [ ] Display exact MCP stdio command in permission prompt: `"MCP (stdio) — will run: npx -y @modelcontextprotocol/server-github"` (ADR-008)
- [ ] Copy hooks to `.github/hooks/{name}.json`
- [ ] Copy skills to `.github/skills/{skill-name}/SKILL.md`
- [ ] Update `.renre-kit/extensions.json` (add entry with version, source, marketplace)
- [ ] If server running: notify worker to mount extension

### 7.3 `renre-kit marketplace add`
- [ ] Parse `[marketplace/]extension[@version]` pattern
- [ ] Resolve marketplace (default if not specified, prompt on ambiguity)
- [ ] Resolve version (latest if not specified)
- [ ] Interactive: show permissions prompt with @clack, settings wizard
- [ ] Non-interactive: `--yes` skips prompts
- [ ] `--local <path>` for local extension install (copy or symlink)
- [ ] Marketplace JSON file resolution: when user registers a repo URL, resolve to `.renre-kit/marketplace.json` within that repo (ADR-005)
- [ ] One-click install for extensions with no required settings — skip settings step entirely (ADR-025)
- [ ] Notify worker: `POST /api/projects/{id}/extensions/reload`

### 7.4 `renre-kit marketplace remove`
- [ ] Verify extension is installed in project
- [ ] If server running: notify worker to unmount + rollback migrations
- [ ] Remove from `.renre-kit/extensions.json`
- [ ] Delete `.github/hooks/{name}.json`
- [ ] Delete `.github/skills/{skill-name}/` directories
- [ ] Keep global cache (other projects may use it)
- [ ] Interactive: confirmation prompt

### 7.5 `renre-kit marketplace upgrade`
- [ ] Single extension: resolve latest version from marketplace
- [ ] Compare with installed version — skip if up to date
- [ ] Download new version to global cache
- [ ] Check for new required settings — block upgrade if unconfigured
- [ ] Check for new permissions — prompt user to accept
- [ ] Update extensions.json version pin
- [ ] Update hooks/skills from new version
- [ ] If server running: unmount old → run new migrations → mount new
- [ ] `--all` flag: iterate all installed extensions

### 7.6 `renre-kit marketplace search`
- [ ] Refresh marketplace cache if stale
- [ ] Search across all registered marketplaces
- [ ] Display results as table: name, version, marketplace, description, installed status

### 7.7 `renre-kit marketplace list`
- [ ] Read `.renre-kit/extensions.json`
- [ ] Display installed extensions with version, source, marketplace
- [ ] Show update availability from cache

### 7.8 Marketplace management
- [ ] `renre-kit marketplace register <url> --name <name>` — add to config.json
- [ ] `renre-kit marketplace unregister <name>` — remove from config.json
- [ ] `renre-kit marketplace list-sources` — list registered marketplaces (or include in `list`)

### 7.9 Extension Disable/Enable (ADR-025)
- [ ] `POST /api/projects/{id}/extensions/{name}/disable` — unmount without removing (toggle state)
- [ ] `POST /api/projects/{id}/extensions/{name}/enable` — remount extension
- [ ] Store enabled/disabled state in `extensions.json` per extension
- [ ] Disabled extensions skip mounting on project registration

### 7.10 Backup CLI commands (ADR-042)
- [ ] `renre-kit backup` — create a manual backup of `data.db` now
- [ ] `renre-kit backup list` — list available backups with size and age
- [ ] `renre-kit backup restore <file>` — restore from a specific backup (stops server first, copies backup over `data.db`, restarts)
- [ ] Reuse `BackupManager` from Phase 3 worker service

### 7.11 Update checker (for `renre-kit start`)
- [ ] Non-blocking: compare installed versions vs marketplace cache
- [ ] Print notice if updates available
- [ ] Do not delay server startup

### 7.12 JSON Schema for marketplace.json (ADR-015)
- [ ] Author `schemas/marketplace.json` — JSON Schema for the marketplace index format (name, url, version, extensions array with name, version, description, repository, path, tags)
- [ ] Add `$schema` field to `.renre-kit/marketplace.json`

## Verification
```bash
# Register default marketplace (if not auto-configured)
renre-kit marketplace register https://github.com/x/renre-kit --name official

# Search
renre-kit marketplace search test
# → table of matching extensions

# Install
renre-kit marketplace add official/example-extension@1.0.0
# → Permission prompt, download, validate, install

# List
renre-kit marketplace list
# → Shows installed extensions

# Upgrade
renre-kit marketplace upgrade example-extension
# → "Already up to date" or upgrades

# Remove
renre-kit marketplace remove example-extension --yes
# → Unmount, rollback, cleanup
```

## Files Created
```
packages/cli/src/commands/marketplace.ts
packages/cli/src/commands/backup.ts
packages/cli/src/services/marketplace-client.ts
packages/cli/src/services/extension-installer.ts
packages/cli/src/services/update-checker.ts
schemas/marketplace.json
```
