# ADR-012: SQL Migration Format

## Status
Accepted

## Context
Extensions that need persistent storage declare migrations in their manifest. We need to define the migration file format, naming convention, execution strategy, and rollback mechanism.

## Decision

### Format: Plain SQL Files
Migrations are plain `.sql` files — no TypeScript, no JavaScript. Simple, portable, and auditable.

### Naming Convention
```
migrations/
  001_create_issues_table.up.sql
  001_create_issues_table.down.sql
  002_add_priority_column.up.sql
  002_add_priority_column.down.sql
```

- `{version}_{description}.up.sql` — forward migration
- `{version}_{description}.down.sql` — rollback migration
- Version is a zero-padded sequential number (001, 002, ...)
- Every `up` migration **must** have a corresponding `down` migration

### Migration Tracking Table
A shared `_migrations` table in SQLite tracks applied migrations:
```sql
CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  extension_name TEXT NOT NULL,
  version TEXT NOT NULL,        -- e.g. "001"
  description TEXT NOT NULL,    -- e.g. "create_issues_table"
  project_id TEXT NOT NULL,     -- scoped to project
  applied_at TEXT NOT NULL,     -- ISO timestamp
  UNIQUE(extension_name, version, project_id)
);
```

### Execution Strategy

**On extension mount (project registration):**
1. Read migration files from `~/.renre-kit/extensions/{name}/{version}/migrations/`
2. Query `_migrations` for already-applied versions (filtered by extension + project)
3. Run pending `up` migrations in order, wrapped in a transaction per migration
4. If any migration fails → rollback that transaction → run `down.sql` for migrations that succeeded in this batch (reverse order) → abort mount → report error. This full-batch rollback ensures the database returns to a consistent pre-migration state

**On extension uninstall (`marketplace remove`):**
1. Query `_migrations` for applied versions (filtered by extension + project)
2. Run `down` migrations in **reverse order**, each in its own transaction
3. Delete migration tracking rows for this extension + project
4. If rollback fails → abort uninstall → report error with manual cleanup instructions

### Project Scoping
All extension tables **must** include a `project_id` column. Migrations create project-aware schemas:
```sql
-- 001_create_issues_table.up.sql
CREATE TABLE IF NOT EXISTS jira_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jira_issues_project ON jira_issues(project_id);

-- 001_create_issues_table.down.sql
DROP TABLE IF EXISTS jira_issues;
```

### Version Upgrade Migrations
When an extension upgrades (e.g., v1.0.0 → v1.2.0):
1. New version may include migrations 001-005 (v1.0.0 had 001-003)
2. Mount reads `_migrations` → finds 001-003 already applied
3. Only runs 004 and 005 as pending migrations
4. Migration numbering is cumulative across extension versions

### Core Table Migrations

Core RenRe Kit tables (`_vault`, `_sessions`, `_observations`, etc.) use the same migration format and runner. See **ADR-043** for the full core migration strategy, including:
- Reserved `extension_name = '__core__'` / `project_id = '__global__'` in the tracking table
- Execution on server start (before extension loading)
- Append-only immutability rule for released migrations

## Consequences

### Positive
- Plain SQL is readable, auditable, and requires no runtime
- Bidirectional (up/down) ensures clean uninstall
- Transaction-per-migration prevents partial schema corruption
- Project scoping is enforced by convention and documented in SDK

### Negative
- Extension authors must write rollback SQL manually
- No automatic schema diffing — manual migration authoring
- Complex schema changes (data transforms) are harder in plain SQL

### Mitigations
- Extension SDK provides migration template generator
- Documentation with common migration patterns (add column, rename, etc.)
- Future: migration validation in `marketplace add` to catch missing `down` files
