# Phase 1 — WorktreeManager Core

## Goal

Implement the core WorktreeManager module that creates, removes, and manages git worktrees for automations and users. Includes SQL schema, lifecycle management, cleanup policies, startup reconciliation, and disk usage tracking.

## Reference

- ADR-051: Git Worktree Management (§1-5, §9-10, §13)

## Dependencies

None — standalone worker-service module.

## Tasks

### 1.1 SQL Migration: `_worktrees` Table

File: `packages/worker-service/migrations/0XX_worktrees.up.sql` (next available number)

- [ ] Create `_worktrees` table with all columns from ADR-051 §5:
  ```sql
  CREATE TABLE _worktrees (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    branch TEXT NOT NULL,
    base_branch TEXT,
    status TEXT NOT NULL DEFAULT 'creating'
      CHECK (status IN ('creating', 'ready', 'in_use', 'completed', 'error', 'removing')),
    created_by_type TEXT NOT NULL CHECK (created_by_type IN ('automation', 'chat', 'user')),
    created_by_automation_id TEXT,
    created_by_automation_run_id TEXT,
    created_by_chat_session_id TEXT,
    cleanup_policy TEXT NOT NULL DEFAULT 'always'
      CHECK (cleanup_policy IN ('always', 'on_success', 'never', 'ttl')),
    ttl_ms INTEGER,
    disk_usage_bytes INTEGER,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_accessed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    completed_at TEXT,
    error TEXT
  );
  ```
- [ ] Create all indexes from ADR-051 §5:
  - `idx_worktrees_project` on `(project_id)`
  - `idx_worktrees_status` on `(project_id, status)`
  - `idx_worktrees_automation` on `(created_by_automation_id)`
  - `idx_worktrees_cleanup` on `(cleanup_policy, status)`
- [ ] Create corresponding `0XX_worktrees.down.sql`:
  ```sql
  DROP TABLE IF EXISTS _worktrees;
  ```

### 1.2 Worktree Data Types

File: `packages/worker-service/src/core/worktree-manager.ts` (types section at top)

- [ ] Define `Worktree` interface matching ADR-051 §2:
  - `id`, `projectId`, `path`, `branch`, `baseBranch?`, `status`, `createdBy`, `createdAt`, `lastAccessedAt`, `diskUsageBytes?`, `cleanupPolicy`, `metadata?`
- [ ] Define `WorktreeStatus` type: `"creating" | "ready" | "in_use" | "completed" | "error" | "removing"`
- [ ] Define `WorktreeCreator` interface: `type` + optional `automationId`, `automationRunId`, `chatSessionId`
- [ ] Define `CleanupPolicy` type: `"always" | "on_success" | "never" | "ttl"`
- [ ] Define `WorktreeCreateOptions` interface matching ADR-051 §2:
  - `projectId`, `branch`, `createBranch?`, `baseBranch?`, `cleanupPolicy`, `ttlMs?`, `createdBy`, `metadata?`
- [ ] Define `CleanupResult` interface: `removed`, `freedBytes`, `errors: Array<{ worktreeId: string; error: string }>`

### 1.3 WorktreeManager Class — Constructor & Lifecycle

File: `packages/worker-service/src/core/worktree-manager.ts`

- [ ] Export `WorktreeManager` class with constructor accepting `db: Database` and `io: SocketIOServer` (for event emissions)
- [ ] Private fields: `db`, `io`, `cleanupTimer: NodeJS.Timeout | null`, `logger` (use existing logger module)
- [ ] Implement `start()` method — startup reconciliation (ADR-051 §9.2):
  1. Mark all `in_use` worktrees as `error` (worker restarted while in use)
  2. Mark all `creating`/`removing` worktrees as `error` (interrupted mid-operation)
  3. Detect orphans: directories on disk not tracked in DB, for all known projects
  4. Remove orphan directories (`git worktree remove --force`, fall back to `fs.rmSync`)
  5. Run `git worktree prune` for all projects
  6. Start periodic cleanup timer (`setInterval` with `config.cleanupIntervalMs`)
  7. Log all reconciliation actions
- [ ] Implement `stop()` method:
  - Clear cleanup timer
  - No active operations to cancel in v1

### 1.4 WorktreeManager — CRUD Operations

File: `packages/worker-service/src/core/worktree-manager.ts`

- [ ] Implement `create(opts: WorktreeCreateOptions): Promise<Worktree>`:
  1. Verify project path is a git repo (`git rev-parse --git-dir`)
  2. Generate UUID for worktree ID
  3. Resolve worktree path: `~/.renre-kit/worktrees/{project-id}/{worktree-id}/`
  4. **Auto-branch naming** for automation-created worktrees (ADR-051 §10):
     - If `opts.createdBy.type === "automation"`: auto-generate branch name `renre-auto/{automation-name}/{base-branch}-{unix-timestamp}`
     - Look up automation name from `_automations` table using `opts.createdBy.automationId`
  5. **Branch checkout constraint** (ADR-051 §10): Check if branch is already checked out in another worktree — return error with clear message if so
  6. Insert DB record with status `creating`
  7. Execute git command:
     - Existing branch: `git -C {projectPath} worktree add {worktreePath} {branch}`
     - New branch: `git -C {projectPath} worktree add -b {newBranch} {worktreePath} {baseBranch}`
  8. Update status to `ready`
  9. Emit Socket.IO `worktree:created` event to `project:{projectId}` room
  10. On git error: update status to `error`, store error message, emit `worktree:error`
  11. Return `Worktree` object

- [ ] Implement `remove(worktreeId: string): Promise<void>`:
  1. Get worktree from DB
  2. Reject if status is `in_use` (cannot remove active worktree)
  3. Update status to `removing`
  4. Check for uncommitted changes — emit warning via Socket.IO if changes detected
  5. Execute `git -C {projectPath} worktree remove {worktreePath} --force`
  6. Delete DB record
  7. Emit Socket.IO `worktree:removed` event
  8. On error: update status to `error`

- [ ] Implement `list(projectId: string): Promise<Worktree[]>`:
  - Query `_worktrees` filtered by `project_id`, ordered by `created_at DESC`
  - Map DB rows to `Worktree` interface (parse `metadata_json`)

- [ ] Implement `get(worktreeId: string): Promise<Worktree>`:
  - Query by `id`, throw if not found
  - Map DB row to `Worktree` interface

- [ ] Implement `setStatus(worktreeId: string, status: WorktreeStatus): Promise<void>`:
  - Update `status` column
  - If `status === "error"`: set `error` column from optional parameter
  - Emit `worktree:status-changed` with `{ worktreeId, oldStatus, newStatus }`

- [ ] Implement `markInUse(worktreeId: string): Promise<void>`:
  - Update `status = 'in_use'`, `last_accessed_at = now()`
  - Emit `worktree:in-use` event with payload constructed from DB:
    - `worktreeId`
    - `automationRunId`: read from `created_by_automation_run_id` column (null if not automation)
    - `chatSessionId`: read from `created_by_chat_session_id` column (null if not chat)

- [ ] Implement `markCompleted(worktreeId: string, success: boolean): Promise<void>`:
  1. Update status to `completed`, set `completed_at`
  2. Emit `worktree:completed { worktreeId, success }`
  3. Apply cleanup policy:
     - `always`: call `remove(worktreeId)` immediately
     - `on_success` + success=true: call `remove(worktreeId)`
     - `on_success` + success=false: retain (keep for debugging)
     - `never`: retain
     - `ttl`: retain, `runCleanup()` handles TTL expiry

### 1.5 WorktreeManager — Disk Management

File: `packages/worker-service/src/core/worktree-manager.ts`

- [ ] Implement `updateDiskUsage(worktreeId: string): Promise<number>`:
  - Calculate directory size (recursive `du -sb` equivalent using `fs.statSync` or platform command)
  - Update `disk_usage_bytes` in DB
  - Return size in bytes

- [ ] Implement `totalDiskUsage(projectId: string): Promise<number>`:
  - `SELECT SUM(disk_usage_bytes) FROM _worktrees WHERE project_id = ?`
  - Return total bytes

### 1.6 WorktreeManager — Cleanup

File: `packages/worker-service/src/core/worktree-manager.ts`

- [ ] Implement `runCleanup(): Promise<CleanupResult>` (ADR-051 §9.1):
  1. **TTL expiry**: query worktrees with `cleanup_policy = 'ttl'` and `status IN ('ready', 'completed')` past their TTL, remove each
  2. **Orphan detection**: call `detectOrphans()` for all projects, remove orphan directories
  3. **Disk limit**: if `totalDiskUsage > maxWorktreeDiskBytes`, remove oldest `completed` worktrees until under limit
  4. **Stale in_use**: query worktrees `status = 'in_use'` with `last_accessed_at` older than `staleTimeoutMs`, mark as `error` with message "Stale: owner process did not clean up", emit `worktree:status-changed`
  5. **git worktree prune** for all projects
  6. Return `CleanupResult` with count, freed bytes, errors

- [ ] Implement `detectOrphans(projectId: string): Promise<string[]>`:
  - List directories under `~/.renre-kit/worktrees/{projectId}/`
  - Compare against DB records
  - Return paths not tracked in DB

- [ ] Implement `prune(projectId: string): Promise<void>`:
  - Get project path from projects table
  - Execute `git -C {projectPath} worktree prune`

### 1.7 WorktreeManager — Internal Helpers

File: `packages/worker-service/src/core/worktree-manager.ts`

- [ ] Implement `private resolveWorktreePath(projectId: string, worktreeId: string): string`:
  - Returns `path.join(config.basePath, projectId, worktreeId)`
  - **Security** (ADR-051 §13): validate resolved path is under `basePath`, reject `..` or symlinks escaping base

- [ ] Implement `private execGit(projectPath: string, args: string[]): Promise<string>`:
  - Spawn `git` process with given args
  - Return stdout
  - Throw on non-zero exit code with stderr

- [ ] Implement `private getProjectPath(projectId: string): Promise<string>`:
  - Query `_projects` table for project filesystem path
  - Used by `create()`, `prune()`, `detectOrphans()`

### 1.8 Worktree Configuration Types

File: `packages/worker-service/src/core/worktree-manager.ts` (or dedicated config section)

- [ ] Define default config values matching ADR-051 §9.3:
  ```typescript
  const WORKTREE_DEFAULTS = {
    basePath: path.join(os.homedir(), ".renre-kit", "worktrees"),
    maxWorktreeDiskMb: 500,
    defaultTtlMs: 86400000,      // 24h
    cleanupIntervalMs: 3600000,  // 1h
    staleTimeoutMs: 7200000,     // 2h
  };
  ```
- [ ] Read overrides from `~/.renre-kit/config.json` → `worktrees` key
- [ ] Compute `maxWorktreeDiskBytes` from `maxWorktreeDiskMb`

### 1.9 Tests

File: `packages/worker-service/src/core/worktree-manager.test.ts`

- [ ] Test `create()`: new branch, existing branch, auto-naming for automation type
- [ ] Test `create()`: branch checkout conflict returns error
- [ ] Test `create()`: non-git directory returns error
- [ ] Test `remove()`: rejects if status is `in_use`
- [ ] Test `remove()`: succeeds for `ready`/`completed`/`error` worktrees
- [ ] Test `markCompleted()`: cleanup policy `always` triggers removal
- [ ] Test `markCompleted()`: cleanup policy `on_success` + failure retains worktree
- [ ] Test `markCompleted()`: cleanup policy `never` retains worktree
- [ ] Test `runCleanup()`: TTL expiry removes expired worktrees
- [ ] Test `runCleanup()`: stale detection marks old `in_use` as `error`
- [ ] Test `start()`: startup reconciliation marks `in_use`/`creating`/`removing` as `error`
- [ ] Test `resolveWorktreePath()`: path traversal rejection
- [ ] Test `list()` and `get()`: correct mapping from DB rows
- [ ] Test `create()`: rejects detached HEAD (no branch name) — v1 always requires a branch
- [ ] Test that `WorktreeManager` is NOT exported in any extension-facing interface (extensions have no access to worktrees — ADR-051 §13)

## Verification

```bash
pnpm run lint
pnpm run lint:duplication
pnpm --filter @renre-kit/worker-service test -- --run worktree-manager
pnpm run build
```
