# ADR-043: Core Schema Migration Strategy

## Status
Accepted

## Context
ADR-012 defines the migration format for extension tables. However, RenRe Kit itself creates core tables (`_vault`, `_migrations`, `_sessions`, `_observations`, `_tool_rules`, `_prompts`, `_agent_errors`, `_tool_usage`, `_subagent_events`, `_hook_activity`, `_session_checkpoints`, `_error_patterns`, `_context_providers`) that require schema evolution as the tool upgrades across releases.

Without a versioned migration strategy for core tables, upgrading RenRe Kit would break the database, lose data, or require users to delete and recreate `data.db`.

## Decision

### Reuse Extension Migration Format for Core Tables

Core schema migrations follow the same format as extension migrations (ADR-012):

- Plain SQL files: `{version}_{description}.up.sql` / `.down.sql`
- Zero-padded sequential versions (001, 002, ...)
- Every `up` has a matching `down`

### Core Migration Directory

```
packages/worker-service/src/migrations/core/
  001_initial_schema.up.sql        # _vault, _migrations tables
  001_initial_schema.down.sql
  002_hook_intelligence.up.sql     # _sessions, _observations, _tool_rules, etc.
  002_hook_intelligence.down.sql
  005_create_fts_indexes.up.sql    # FTS5 virtual tables + sync triggers
  005_create_fts_indexes.down.sql
```

These files are bundled with the worker service build and shipped to `~/.renre-kit/migrations/core/` on first run or upgrade.

### Core Migration Tracker

The existing `_migrations` table is reused with a reserved extension name:

```sql
-- Core migrations use extension_name = '__core__' and project_id = '__global__'
INSERT INTO _migrations (extension_name, version, description, project_id, applied_at)
VALUES ('__core__', '001', 'initial_schema', '__global__', datetime('now'));
```

- `extension_name = '__core__'` distinguishes core from extension migrations
- `project_id = '__global__'` since core tables are global (they use `project_id` columns for data scoping, but the schema itself is not project-specific)
- Extension names beginning with `__` are reserved — manifest validator rejects them

### Execution on Server Start

On every server start, the worker service:

1. Ensures the `_migrations` table exists (bootstrap — this table is created before migration tracking begins)
2. Reads core migration files from the bundled directory
3. Queries `_migrations` for applied `__core__` versions
4. Runs pending `up` migrations in order, each wrapped in a transaction
5. Creates a pre-migration backup before any core migration runs (ADR-042)
6. On failure: rollback batch (run `down.sql` for migrations that succeeded in reverse order), log critical error with backup path, refuse to start

### Version Upgrade Path

When a user upgrades RenRe Kit (e.g., 0.3.0 → 0.5.0):

1. New worker service binary starts
2. Detects pending core migrations (e.g., 003, 004)
3. Creates pre-migration backup: `data-{timestamp}-pre-core-upgrade.db`
4. Runs migrations sequentially
5. On success: server starts normally
6. On failure: automatic rollback, user notified to restore backup or downgrade

### Immutability Rule

Core migration files are **append-only** and **immutable** once released:
- Never modify a released migration file
- Never delete a released migration file
- Schema changes always go into a new numbered migration
- This ensures any upgrade path (e.g., 0.1.0 → 0.8.0) produces the same final schema

### Bootstrap Sequence

The `_migrations` table itself is created outside the migration system (chicken-and-egg):

```sql
-- Always runs on startup, idempotent
CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  extension_name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT NOT NULL,
  project_id TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  UNIQUE(extension_name, version, project_id)
);
```

After this, core migration `001_initial_schema` creates the `_vault` table and any other foundational tables. Subsequent core migrations add intelligence tables, FTS indexes, etc.

## Consequences

### Positive
- Core schema evolves safely across releases using proven migration infrastructure
- Users upgrade without data loss or manual database recreation
- Pre-migration backups protect against failed upgrades
- Same tooling for core and extension migrations reduces complexity
- Append-only rule guarantees any upgrade path produces identical schema

### Negative
- Core migrations add startup time on first upgrade (negligible — runs once per new version)
- Migration files must be bundled with the worker service build
- Cannot use destructive schema changes without data migration SQL

### Mitigations
- DDL operations are near-instant in SQLite — startup overhead is minimal
- Build pipeline includes migration files automatically via tsup assets config
- Complex data migrations documented with patterns in SDK
