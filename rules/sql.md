# SQL Rules

## Database Setup

- Single shared SQLite database at `~/.renre-kit/data.db`
- WAL mode enabled on connection: `PRAGMA journal_mode=WAL`
- Use `better-sqlite3` — synchronous API, no async wrappers
- Extensions never receive raw database handle — always `ScopedDatabase` proxy

## Table Naming

- Core tables prefixed with `_`: `_migrations`, `_vault`, `_sessions`, `_observations`, `_tool_rules`, `_tool_audit`, `_prompts`, `_agent_errors`, `_error_patterns`, `_tool_usage`, `_subagent_events`, `_hook_activity`, `_context_providers`
- Extension tables prefixed with `ext_{extensionName}_`: `ext_jira_issues`, `ext_slack_channels`
- FTS5 virtual tables suffixed with `_fts`: `_prompts_fts`, `_observations_fts`
- Indexes named `idx_{table}_{column}`: `idx_jira_issues_project`
- FTS triggers named `_{table}_fts_{action}`: `_prompts_fts_insert`

## Column Conventions

- Primary key: `id INTEGER PRIMARY KEY AUTOINCREMENT`
- Project scoping: `project_id TEXT NOT NULL` — required on every table except `_vault` and `_migrations`
- Timestamps: `TEXT` columns with ISO 8601 values, default `datetime('now')`
- Booleans: `INTEGER` (0/1), not TEXT
- Encrypted data: `BLOB` (for vault values)
- All column and table names lowercase with underscores

## Project Scoping

Every query touching project data must filter by `project_id`. The ScopedDatabase proxy auto-injects this for extensions, but core code must do it manually:

```sql
-- Correct
SELECT * FROM _sessions WHERE project_id = ?;

-- Wrong: leaks data across projects
SELECT * FROM _sessions;
```

## ScopedDatabase Proxy Enforcement

- Extensions can only access `ext_{their-name}_*` tables
- Core tables (`_migrations`, `_vault`, etc.) are blocked
- Allowed DDL: `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE ADD COLUMN`
- Blocked DDL: `DROP TABLE`, `DROP INDEX`, `ALTER TABLE DROP COLUMN`
- `project_id` auto-injected in WHERE clauses for SELECT/UPDATE/DELETE
- INSERT statements must include `project_id` explicitly

## Migration Files

File naming: `{NNN}_{description}.{direction}.sql`
```
migrations/
  001_create_issues_table.up.sql
  001_create_issues_table.down.sql
  002_add_priority_column.up.sql
  002_add_priority_column.down.sql
```

Rules:
- Version numbers zero-padded to 3 digits (001, 002, ...)
- Every `.up.sql` must have a corresponding `.down.sql`
- Each migration runs in its own transaction
- On failure: rollback current transaction, then run `.down.sql` for all succeeded migrations in reverse order
- Extension tables in migrations must include `project_id TEXT NOT NULL`

Tracking table:
```sql
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

On upgrade: only run migrations not yet in `_migrations` (e.g., 001-003 applied → run 004-005).
On uninstall: run `.down.sql` in reverse order, delete tracking rows.

## Pre-Migration Backups

Mandatory before any migration:
1. `PRAGMA wal_checkpoint(TRUNCATE)` — flush WAL
2. `fs.copyFileSync(dataDbPath, backupPath)` — atomic copy
3. `PRAGMA integrity_check` on backup — verify
4. If backup fails → abort migration

Backup path: `~/.renre-kit/backups/data-{ISO-timestamp}-pre-{operation}.db`

Retention: max 10 backups, max 30 days. Backups within 7 days of a migration are never auto-deleted.

## FTS5 Full-Text Search

Use external content pattern (no data duplication):
```sql
CREATE VIRTUAL TABLE _prompts_fts USING fts5(
  prompt, intent_category,
  content=_prompts, content_rowid=rowid,
  tokenize='porter unicode61'
);
```

Sync via triggers on the content table:
- AFTER INSERT: insert into FTS
- AFTER UPDATE: delete old, insert new
- BEFORE DELETE: remove from FTS

Tokenizer: `porter unicode61` — Unicode-aware with English stemming.

Query syntax:
```sql
-- Basic search
SELECT * FROM _prompts_fts WHERE _prompts_fts MATCH 'authentication';

-- Prefix search
SELECT * FROM _prompts_fts WHERE _prompts_fts MATCH 'auth*';

-- Phrase search
SELECT * FROM _prompts_fts WHERE _prompts_fts MATCH '"invalid token"';

-- Boolean
SELECT * FROM _prompts_fts WHERE _prompts_fts MATCH 'auth AND error NOT network';

-- Column-scoped
SELECT * FROM _prompts_fts WHERE _prompts_fts MATCH 'intent_category:bug-fix';

-- Ranked results
SELECT *, rank FROM _prompts_fts WHERE _prompts_fts MATCH ? ORDER BY rank;
```

## Core Table Schemas

```sql
-- Vault (global, not project-scoped)
CREATE TABLE IF NOT EXISTS _vault (
  key TEXT PRIMARY KEY,
  encrypted_value BLOB,
  iv TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- Sessions
CREATE TABLE IF NOT EXISTS _sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  summary TEXT,
  started_at TEXT,
  ended_at TEXT
);

-- Observations
CREATE TABLE IF NOT EXISTS _observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  source TEXT,          -- 'core', 'extension', 'user', 'agent'
  confidence REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tool governance rules
CREATE TABLE IF NOT EXISTS _tool_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  tool_pattern TEXT NOT NULL,
  decision TEXT NOT NULL,   -- 'allow', 'deny', 'ask'
  hit_count INTEGER DEFAULT 0
);

-- Prompts
CREATE TABLE IF NOT EXISTS _prompts (
  rowid INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  intent_category TEXT,
  session_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Error tracking
CREATE TABLE IF NOT EXISTS _agent_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  error_message TEXT,
  error_name TEXT,
  error_stack TEXT,
  fingerprint TEXT,
  session_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Error patterns (aggregated)
CREATE TABLE IF NOT EXISTS _error_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  occurrence_count INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',  -- 'active', 'resolved', 'ignored'
  first_seen TEXT,
  last_seen TEXT
);
```
