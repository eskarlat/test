# ADR-042: Database Backup and Recovery

## Status
Accepted

## Context
The shared SQLite database (`~/.renre-kit/data.db`) contains all extension data, Vault secrets, intelligence data, and core state. Corruption or failed migrations can result in data loss across all projects. We need a backup strategy that protects against these risks without requiring manual intervention.

## Decision

### Automatic Backups

**Pre-migration backups (mandatory):**
Before running any migration (extension install, upgrade, or core schema migration), the worker service creates a backup:

```
~/.renre-kit/backups/data-{ISO-timestamp}-pre-{operation}.db
```

Examples:
- `data-20260308T100000-pre-jira-plugin-upgrade-0.0.1-to-0.0.2.db`
- `data-20260308T100000-pre-core-migration-003.db`

**Backup procedure:**
1. Run `PRAGMA wal_checkpoint(TRUNCATE)` to flush WAL to main DB file
2. `fs.copyFileSync(dataDbPath, backupPath)` — atomic copy
3. Verify backup integrity: open backup DB, run `PRAGMA integrity_check`
4. If backup fails (disk full, permission error, integrity check fails) → abort the migration

**Periodic backups (optional, configurable):**
Users can enable periodic backups in `~/.renre-kit/config.json`:
```json
{
  "backup": {
    "enabled": true,
    "intervalHours": 24,
    "maxCount": 10,
    "maxAgeDays": 30
  }
}
```
Periodic backups run on server start if the last backup is older than `intervalHours`.

### Retention Policy

- **Max count:** 10 backups retained (default). Oldest pruned first.
- **Max age:** 30 days (default). Expired backups deleted on server start.
- **Pre-migration backups are never auto-deleted within 7 days** — even if max count is reached, recent migration backups are preserved.

### Restore Procedure

```bash
# List available backups
renre-kit backup list

# Output:
# Backups in ~/.renre-kit/backups/:
#   1. data-20260308T100000-pre-jira-upgrade.db  (2.1 MB, 2 hours ago)
#   2. data-20260307T090000-pre-core-migration.db (2.0 MB, 1 day ago)
#   3. data-20260306T120000-periodic.db            (1.9 MB, 2 days ago)

# Restore (stops server, replaces data.db, restarts)
renre-kit backup restore data-20260308T100000-pre-jira-upgrade.db

# Or manual restore
renre-kit stop
cp ~/.renre-kit/backups/{backup-file} ~/.renre-kit/data.db
renre-kit start
```

### Vault Backup Considerations

The `_vault` table is included in database backups. Since Vault values are encrypted with a machine-derived key (ADR-009), backups are only restorable on the same machine (same hostname + username). This is acceptable for the local-tool use case.

**Future:** `renre-kit vault export` / `renre-kit vault import` commands for cross-machine secret migration (encrypted with a user-provided password).

### Integrity Monitoring

On server start, the worker runs `PRAGMA integrity_check` on `data.db`. If corruption is detected:
1. Log a critical error with details
2. Attempt to find the most recent valid backup
3. If found, prompt the user: `"Database corruption detected. Restore from backup {name}? (y/N)"`
4. If no backups exist, log: `"No backups available. Run 'renre-kit backup' to create one before further operations."`

### CLI Commands

| Command | Description |
|---------|-------------|
| `renre-kit backup` | Create a manual backup now |
| `renre-kit backup list` | List available backups with size and age |
| `renre-kit backup restore <file>` | Restore from a specific backup (stops server first) |

## Consequences

### Positive
- Failed migrations no longer risk permanent data loss
- Automatic retention prevents unbounded disk usage
- Integrity monitoring catches corruption early
- Restore procedure is simple and documented

### Negative
- Disk space overhead for backups (mitigated by retention policy)
- Pre-migration checkpoint + copy adds ~100-500ms to migration operations
- Backups are machine-specific (Vault encryption tied to machine identity)

### Mitigations
- Configurable retention limits
- WAL checkpoint ensures backup consistency
- Integrity verification on both backup creation and server start
- Future: cross-machine Vault export/import
