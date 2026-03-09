# Phase 4 — Extension System

## Goal
Implement the core extension system: loading extension backends, mounting/unmounting routers per project, running SQL migrations, and validating manifests.

## Reference
- ADR-002: Extension Lazy Loading (crash isolation)
- ADR-004: UI Dynamic Module Loading
- ADR-008: MCP Bridge (command allowlist)
- ADR-011: Extension Version Pinning
- ADR-012: SQL Migration Format
- ADR-016: Extension Upgrade Flow (pre-migration backup, rollback)
- ADR-017: Extension Permissions (enforced where possible)
- ADR-019: Extension SDK Contract (ScopedDatabase proxy)
- ADR-020: Manifest Validation
- ADR-036: Extension Context Provider
- ADR-042: Database Backup and Recovery
- ADR-043: Core Schema Migrations (reserved `__` prefix)
- ADR-044: Extension SDK API Versioning
- C4 Code: ExtensionRegistry, ExtensionLoader, ExtensionContext

## Dependencies
- Phase 3 (worker service core)

## Tasks

### 4.1 Extension Registry
- [ ] `ExtensionRegistry` class: tracks mounted extensions per project
- [ ] `mount(projectId, extensionName, version)` — load and register router
- [ ] `unmount(projectId, extensionName)` — remove router, cleanup
- [ ] `unmountAll(projectId)` — unmount all extensions for a project
- [ ] `getRouter(projectId, extensionName)` — resolve mounted router
- [ ] `listMounted(projectId)` — list mounted extension names with status

### 4.2 Extension Loader
- [ ] Version resolution at mount (ADR-011): read version from project's `.renre-kit/extensions.json`, load from `~/.renre-kit/extensions/{name}/{version}/`. Error with clear message if version directory missing
- [ ] `extensions.json` pinning schema includes `source` and `installedAt` per ADR-011: `{ "name": { "version": "1.0.0", "source": "official", "installedAt": "ISO" } }`
- [ ] Read manifest.json from `~/.renre-kit/extensions/{name}/{version}/`
- [ ] Validate manifest (delegate to validator)
- [ ] If `backend.entrypoint` exists: `require()` the router factory
- [ ] Create `ExtensionContext` with projectId, db (ScopedDatabase proxy), logger, resolved config
  - Runtime permission enforcement (ADR-017): if `permissions.database` is `false` or not declared, pass `db: null` in context
  - If `permissions.database` is `true`: create `ScopedDatabase` proxy via `DBManager.createScopedProxy(extensionName, projectId)` — never pass raw handle (ADR-019)
  - If `permissions.vault` declares specific keys, only resolve those Vault keys — reject undeclared keys
- [ ] Extension route handler isolation (ADR-002):
  - Wrap all extension route handlers in try/catch boundary — uncaught exceptions return `500`, not crash the worker
  - Per-request timeout: 30 seconds default (configurable per extension in manifest). On timeout → `504 Gateway Timeout`
  - Circuit breaker: 5 consecutive errors within 60s → suspend extension routes (return `503` with `Retry-After`). Cooldown doubles on consecutive suspensions (60s, 120s, 240s, max 15 minutes)
  - Memory monitoring: periodic `process.memoryUsage()` check, warn + SSE event if heap exceeds 512 MB threshold
- [ ] Call router factory to get Express Router
- [ ] Mount router at `/api/{projectId}/{extensionName}/*`

### 4.3 Project Router (namespace middleware)
- [ ] Route `/api/{projectId}/*` to project-specific extension routers
- [ ] Validate projectId is a registered active project
- [ ] 404 if project not found, 404 if extension not mounted

### 4.4 Migration Runner
- [ ] Read migration files from extension's `migrations/` directory
- [ ] Parse naming convention: `{NNN}_{description}.up.sql` / `.down.sql`
- [ ] Check `_migrations` table for already-applied versions (per extension + project)
- [ ] Run pending `.up.sql` files in order, each in a transaction
- [ ] On failure: rollback transaction, abort mount, log error
- [ ] `rollbackMigrations()`: run `.down.sql` files in reverse order
- [ ] Delete migration tracking rows on rollback

### 4.5 Manifest Validator
- [ ] Validate required fields: name, version, displayName, description, author
- [ ] Name format: `/^[a-z0-9-]+$/`
- [ ] Version format: valid semver
- [ ] Conditional checks: backend entrypoint exists, UI bundle exists, migrations paired
- [ ] `minSdkVersion`: if present, validate as valid semver string. If marketplace extension, `minSdkVersion` is required. Warn if >2 minor versions behind current SDK (ADR-044)
- [ ] SDK compatibility check at mount time: `extension.minSdkVersion <= current SDK version`. If incompatible → abort mount, set `status: "incompatible"`, clear error message (ADR-044)
- [ ] Reject extension names starting with `__` (reserved for core use — ADR-043)
- [ ] `backend.actions`: each action has `name`, `method`, `description` (ADR-020)
- [ ] `ui.pages`: each page has `id`, `title`, `path`; paths are unique (ADR-020)
- [ ] `hooks`: valid hook config structure (version, event keys) (ADR-020)
- [ ] `skills`: each declared skill has a corresponding `SKILL.md` file (ADR-020)
- [ ] `mcp`: if `transport: "stdio"` → `command` and `args` present, `command` must be in allowlist (`node`, `npx`, `python`, `python3`, `deno`, `bun`, `uvx`, `docker`), `args` must not contain shell metacharacters (`;`, `|`, `&`, `` ` ``, `$()`, `>`, `<`) (ADR-008); if `transport: "sse"` → `url` present (ADR-020)
- [ ] `contextProvider`: validate if present (ADR-036): (1) `name` and `description` present, (2) `configSchema` field types are known (`string`, `number`, `boolean`, `select`), (3) `select` type has `options` array, (4) defaults match declared types, (5) extension has `backend` (needs `/__context` route), (6) warn if `hooks.events` doesn't include `sessionStart`
- [ ] Permission fields are known types (`database`, `network`, `mcp`, `hooks`, `vault`, `filesystem`)
- [ ] `network` and `filesystem` permissions are advisory: log access attempts but do not block (ADR-017). Log message: `"Extension '{name}' accessed {network|filesystem} without declaring permission"`
- [ ] Hook dispatch filtering (ADR-017): hook payloads only dispatched to extensions that declare the specific hook event in `permissions.hooks`
- [ ] Settings schema has valid types
- [ ] Return validation result with specific error messages

### 4.6 Extension routes for Console UI
- [ ] `GET /api/{projectId}/extensions` — list mounted extensions with manifest metadata
- [ ] `POST /api/projects/{id}/extensions/reload` — remount a specific extension
- [ ] `POST /api/projects/{id}/extensions/unload` — unmount a specific extension
- [ ] Serve extension UI assets from `~/.renre-kit/extensions/{name}/{version}/ui/` via `GET /api/extensions/{name}/ui/*` (ADR-004)
- [ ] Emit SSE event `extension:installed` / `extension:removed` / `extension:upgraded` after mount/unmount operations (ADR-023, seq-install)

### 4.7 Integration with project registration
- [ ] On project register: read `.renre-kit/extensions.json`, mount all extensions. Quick validation only (ADR-020): verify manifest exists and is parseable, no deep file checks — full validation runs at install time
- [ ] On project unregister: unmount all extensions for that project
- [ ] Handle extension load errors gracefully (log, skip, continue with other extensions)
- [ ] Deferred migration rollback (seq-uninstall): on project register, check for extensions present in `_migrations` but absent from `extensions.json` — run pending rollback migrations. This handles uninstalls that occurred while server was not running

### 4.8 Extension Upgrade Flow (ADR-016)
- [ ] Worker endpoint: `POST /api/projects/{id}/extensions/upgrade` accepting `{ name, targetVersion }`
- [ ] Upgrade sequence: create pre-migration backup → unmount old version → run new migrations (cumulative from current) → mount new version
- [ ] Settings schema evolution: new optional fields auto-merge, new required fields block upgrade until filled, removed fields preserved, type changes require migration
- [ ] **Automatic rollback on migration failure** (ADR-016): if migration N fails, run `down.sql` for migrations that succeeded in this upgrade batch (reverse order), restore previous version in `extensions.json`, remount old version. If rollback also fails → mark extension `status: "failed"`, log backup path for manual recovery
- [ ] Migration compatibility: append-only, cumulative — new version includes all prior migrations

### 4.9 Extension Context Provider (ADR-036)
- [ ] `contextProvider` field in extension manifest with `configSchema`
- [ ] `/__context` POST route contract: receives `ContextRequest { projectId, config, tokenBudget, sessionInput }`, returns `ContextResponse { content, estimatedTokens, itemCount, truncated, metadata? }` (ADR-036)
- [ ] `_context_providers` SQLite table (ADR-036): `(id TEXT PRIMARY KEY, type TEXT NOT NULL, extension_name TEXT, name TEXT NOT NULL, description TEXT NOT NULL, icon TEXT, config_schema TEXT, default_enabled INTEGER DEFAULT 1)` — `id` format: `'core:session-history'` or `'ext:jira-plugin'`, `type`: `'core'` or `'extension'`
- [ ] Provider registration lifecycle: register on install (add to recipe config at bottom, enabled if `defaultEnabled`), remove on uninstall (remove from `_context_providers` + recipe config), update on upgrade (merge config: keep user values, add new fields with defaults)
- [ ] Validation on install (ADR-036): (1) `name` and `description` present, (2) `configSchema` field types known, (3) `select` has `options`, (4) defaults match types, (5) requires `backend`, (6) warn if no `sessionStart` hook
- [ ] Integration point with Context Recipe Engine (Phase 15)

### 4.10 Extension validate command (ADR-020)
- [ ] `renre-kit extension validate /path/to/extension` — standalone validation for extension authors
- [ ] Runs full manifest validation (reuses Phase 4 validator) and reports errors/warnings
- [ ] CLI command implementation in `packages/cli/src/commands/extension.ts`

## Verification
```bash
# Create a test extension manually
mkdir -p ~/.renre-kit/extensions/test-ext/0.1.0/backend
cat > ~/.renre-kit/extensions/test-ext/0.1.0/manifest.json << 'EOF'
{
  "name": "test-ext",
  "version": "0.1.0",
  "displayName": "Test Extension",
  "description": "Test extension for verification",
  "author": "test",
  "backend": { "entrypoint": "backend/index.js" },
  "permissions": { "database": true }
}
EOF

# Create backend with a simple route
cat > ~/.renre-kit/extensions/test-ext/0.1.0/backend/index.js << 'EOF'
module.exports = function(ctx) {
  const { Router } = require("express");
  const router = Router();
  router.get("/hello", (req, res) => res.json({ message: "Hello from test-ext", projectId: ctx.projectId }));
  return router;
};
EOF

# Add to project extensions.json
# Start server, register project
# Test:
curl http://localhost:42888/api/{project-id}/test-ext/hello
# → { "message": "Hello from test-ext", "projectId": "..." }
```

## Files Created
```
packages/worker-service/src/core/extension-registry.ts
packages/worker-service/src/core/extension-loader.ts
packages/worker-service/src/core/extension-circuit-breaker.ts
packages/worker-service/src/core/migration-runner.ts
packages/worker-service/src/core/manifest-validator.ts
packages/worker-service/src/core/mcp-command-validator.ts
packages/worker-service/src/routes/extensions.ts
packages/worker-service/src/middleware/project-router.ts
packages/worker-service/src/middleware/extension-timeout.ts
packages/worker-service/src/core/context-provider-manager.ts
packages/worker-service/src/routes/extension-ui-assets.ts
packages/cli/src/commands/extension.ts
```
