# ADR-003: Shared SQLite Database with Project-Scoped Data

## Status
Accepted

## Context
Extensions may need persistent storage (e.g., Jira plugin caching issues, vault storing secrets). We need to decide on the database strategy.

Options considered:
1. **One DB per project** — `~/.renre-kit/data/{project-id}.db`
2. **One DB per extension per project** — maximum isolation
3. **Single shared DB** — `~/.renre-kit/data.db` with project_id columns

## Decision
**Single shared SQLite database at `~/.renre-kit/data.db`.** All extension tables include a `project_id` column for data isolation. Extensions define migrations that create project-scoped tables.

## Consequences

### Positive
- Single file to backup/manage
- Simpler connection management (one connection pool)
- Cross-project queries possible in future (e.g., aggregate dashboard)
- SQLite handles concurrent reads well for this use case

### Negative
- Must enforce project_id scoping in every query — no DB-level isolation
- Large datasets across many projects could slow single-file DB
- Corruption risk affects all projects (mitigated by WAL mode + backups)

### Mitigations
- Extensions receive a `ScopedDatabase` proxy (ADR-019) — **never the raw `better-sqlite3` handle**. The proxy enforces table prefix isolation (e.g., `ext_jira_*`), automatic `project_id` filtering, and blocks access to core tables (`_vault`, `_migrations`, etc.)
- Extension migrations must include project_id in table schemas and use the extension's table prefix
- WAL mode enabled for concurrent read/write safety
- Pre-migration backup of `data.db` before any migration run (ADR-042)
- Future: migrate to per-project DB files if scale demands it
