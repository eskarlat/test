# Phase 3 — Worker Service Core

## Goal
Implement the Express worker service with core routes (health, projects), SQLite database setup, and logging infrastructure.

## Reference
- ADR-001: Single Server Multi-Project
- ADR-003: Shared SQLite DB
- ADR-010: Server Resilience & Port Handling
- ADR-012: SQL Migration Format
- ADR-013: Logging Strategy
- ADR-023: Real-Time Worker-UI Communication (SSE)
- ADR-041: Cross-Platform Compatibility
- ADR-042: Database Backup and Recovery
- ADR-043: Core Schema Migration Strategy
- C4: Container & Component diagrams

## Dependencies
- Phase 1 (monorepo scaffolding)

## Tasks

### 3.1 Express app setup
- [ ] Create Express app with JSON body parser, CORS middleware
- [ ] Port binding with conflict resolution (ADR-010):
  - Probe `GET /health` on occupied port — if it's an existing renre-kit instance, reuse it
  - If not renre-kit, try fallback ports 42889-42898 (10 attempts max)
  - Write actual port to `~/.renre-kit/server.json`
- [ ] Stale PID detection (ADR-010):
  - Send `kill -0 <pid>` to check if process exists
  - If process exists but `GET /health` doesn't respond within 3 seconds, treat as hung — kill process, delete PID, start fresh
- [ ] Graceful shutdown on SIGTERM/SIGINT/SIGBREAK (ADR-010, ADR-041):
  - Register `SIGINT`, `SIGTERM`, and `SIGBREAK` (Windows) signal handlers
  - Unmount all extensions, close MCP processes, close DB connections, delete PID file
  - Force exit if graceful shutdown takes >5 seconds
- [ ] Request logging middleware (method, URL, status, duration)
  - Never log request/response bodies — only metadata (ADR-013 security requirement)
- [ ] Error handling middleware with error type categorization: `backend`, `ui`, `mcp`, `migration`, `hook` (ADR-013)

### 3.2 Health route
- [ ] `GET /health` → `{ status: "ok", uptime, memoryUsage, port, version }`

### 3.3 Project management routes
- [ ] `POST /api/projects/register` → register project `{ id, name, path, extensions }`
- [ ] `POST /api/projects/unregister` → unregister project `{ id }`
- [ ] `GET /api/projects` → list active projects with extension counts
- [ ] In-memory project registry backed by `server.json` on disk
- [ ] `server.json` stores full `ServerState`: `{ pid, port, startedAt, activeProjects[] }` (ADR-010 + C4-Code)
- [ ] Update `lastActiveAt` in `~/.renre-kit/projects/{id}.json`

### 3.4 SQLite database
- [ ] Initialize better-sqlite3 connection to `~/.renre-kit/data.db`
- [ ] Enable WAL mode for concurrent read/write
- [ ] Bootstrap `_migrations` table with `CREATE TABLE IF NOT EXISTS` (chicken-and-egg — must exist before migration tracking begins, ADR-043)
- [ ] `DBManager` class: `getConnection()`, `runMigrations()`, `rollbackMigrations()`, `createScopedProxy(extensionName, projectId)`
- [ ] `ScopedDatabase` proxy implementation (ADR-019): wraps raw `better-sqlite3` handle with:
  - Table prefix enforcement: queries restricted to `ext_{name}_*` tables
  - Automatic `project_id` injection into WHERE clauses
  - Core table access blocked (`_migrations`, `_vault`, `_sessions`, etc.)
  - DDL restriction: only `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE ADD COLUMN` permitted
- [ ] Separate `MigrationRunner` class (ADR-015 specifies `core/migration-runner.ts` distinct from db-manager):
  - **Pre-migration backup**: before running any migration, `PRAGMA wal_checkpoint(TRUNCATE)` then `fs.copyFileSync()` to `~/.renre-kit/backups/data-{timestamp}-pre-{extension}-{oldVersion}-to-{newVersion}.db` (ADR-016, ADR-042). For non-upgrade operations use `data-{timestamp}-pre-{operation}.db`
  - Verify backup integrity with `PRAGMA integrity_check` on backup copy
  - If backup fails (disk full, permission error) → abort migration
  - Transaction-per-migration: wrap each migration in its own transaction (ADR-012)
  - On failure: run `down.sql` for migrations that succeeded in this batch (reverse order), restore previous version in `extensions.json`, remount old version (ADR-016)
  - If rollback also fails: mark extension `status: "failed"`, log critical error with backup path
  - Rollback-on-uninstall: query `_migrations` for applied versions, run `down` migrations in reverse order, delete tracking rows
  - Supports both extension migrations and core migrations (same runner, different source directories)
- [ ] Backup retention: prune backups older than 30 days, max 10 retained. Pre-migration backups within 7 days never auto-deleted (ADR-042)
- [ ] On server start: run `PRAGMA integrity_check` on `data.db` — if corruption detected: search for most recent valid backup, prompt user to restore, log critical error with backup path (ADR-042)
- [ ] Periodic backups (ADR-042): on server start, check if last backup is older than `intervalHours` (configurable via `~/.renre-kit/config.json` under `backup.intervalHours`, default 24). If so, create automatic backup. Config also supports `backup.maxCount` (default 10) and `backup.maxAgeDays` (default 30)

### 3.4b Core schema migrations (ADR-043)
- [ ] Bundle core migration files in `packages/worker-service/src/migrations/core/`
- [ ] Core migration `001_initial_schema.up.sql`: create `_vault` table (`key TEXT PRIMARY KEY, encrypted_value BLOB, iv TEXT, created_at TEXT, updated_at TEXT`)
- [ ] Core migration `001_initial_schema.down.sql`: drop `_vault` table
- [ ] Core migrations tracked in `_migrations` with `extension_name = '__core__'` and `project_id = '__global__'`
- [ ] On server start: run pending core migrations before any extension loading
- [ ] Pre-migration backup mandatory before core migrations (backup naming: `data-{timestamp}-pre-core-upgrade.db`)
- [ ] On failure: rollback batch, log critical error with backup path, refuse to start
- [ ] Reject extension names starting with `__` (reserved for core use)
- [ ] Copy core migration files to `~/.renre-kit/migrations/core/` on first run or when new migrations are detected

### 3.5 Logger
- [ ] File logger: write to `~/.renre-kit/logs/{YYYY-MM-DD}.txt`
- [ ] Error logger: write structured JSON to `~/.renre-kit/logs/error-{YYYY-MM-DD}.json`
- [ ] Log format: `[ISO timestamp] [LEVEL] [source] message`
- [ ] Log levels: error, warn, info, debug (configurable from config.json)
- [ ] PII filtering (ADR-013): never log Vault values, never log SQL query parameters, redact extension settings with `type: "vault"` as `[REDACTED]`, never log MCP environment variables
- [ ] Create logs directory if not exists
- [ ] `POST /api/errors` route for Console UI error boundary reporting (ADR-013):
  - Accepts `{ source, type, error, stack, context }`
  - Creates `routes/errors.ts`

### 3.6 Event Bus & SSE endpoint (ADR-023)
- [ ] Create global `EventBus` using Node.js `EventEmitter` with typed events
- [ ] `emit(eventType, payload)` — broadcast event to all listeners
- [ ] `GET /api/events` — SSE stream endpoint with headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- [ ] CORS headers for Console UI origin
- [ ] Forward all event bus events to connected SSE clients
- [ ] Keepalive comment every 30 seconds to prevent connection timeout
- [ ] Cleanup on client disconnect (remove listener from event bus)
- [ ] Support multiple concurrent SSE clients
- [ ] In-memory ring buffer of last 100 events for reconnection recovery
- [ ] `GET /api/events/history` — return buffered events (allows Console UI to fill gaps on reconnect)

### 3.7 Static file serving
- [ ] Serve Console UI build from `packages/console-ui/dist/` (placeholder for Phase 11)
- [ ] Fallback to `index.html` for SPA routing

### 3.8 Server entry point
- [ ] CLI-compatible entry: `node packages/worker-service/dist/index.js`
- [ ] Read port from config or CLI args
- [ ] Write PID file on start
- [ ] Print "Worker service started on port {port}"

## Verification
```bash
# Start worker service directly
node packages/worker-service/dist/index.js

# Health check
curl http://localhost:42888/health
# → { "status": "ok", "uptime": 1.2, "port": 42888 }

# Register a project
curl -X POST http://localhost:42888/api/projects/register \
  -H "Content-Type: application/json" \
  -d '{"id":"test-123","name":"test","path":"/tmp/test","extensions":[]}'

# List projects
curl http://localhost:42888/api/projects
# → [{ "id": "test-123", "name": "test", ... }]

# Check log file exists
ls ~/.renre-kit/logs/$(date +%Y-%m-%d).txt

# Check SQLite DB
sqlite3 ~/.renre-kit/data.db ".tables"
# → _migrations
```

## Files Created
```
packages/worker-service/src/index.ts
packages/worker-service/src/app.ts
packages/worker-service/src/routes/health.ts
packages/worker-service/src/routes/projects.ts
packages/worker-service/src/core/db-manager.ts
packages/worker-service/src/core/migration-runner.ts
packages/worker-service/src/core/logger.ts
packages/worker-service/src/core/paths.ts
packages/worker-service/src/core/scoped-database.ts
packages/worker-service/src/core/backup-manager.ts
packages/worker-service/src/core/vault-resolver.ts      # stub for Phase 5
packages/worker-service/src/core/settings-resolver.ts   # stub for Phase 5
packages/worker-service/src/core/mcp-manager.ts         # stub for Phase 9
packages/worker-service/src/core/event-bus.ts
packages/worker-service/src/routes/events.ts
packages/worker-service/src/routes/errors.ts
packages/worker-service/src/routes/backup.ts
packages/worker-service/src/migrations/core/001_initial_schema.up.sql
packages/worker-service/src/migrations/core/001_initial_schema.down.sql
```
