# ADR-051: Git Worktree Management

## Status
Proposed

## Context

RenRe Kit automations (ADR-050) and interactive chat sessions (ADR-047) can use built-in tools that read and write project files. When these operations modify files, they affect the user's active checkout — potentially conflicting with uncommitted work, disrupting IDE state, or causing confusion about which changes came from the automation vs. the user.

Git worktrees solve this by creating **isolated working copies** of the repository that share the same `.git` directory. Each worktree checks out a branch independently, allowing automations (or users) to work in parallel without interfering with the main checkout.

RenRe Kit needs to:
- Create and manage worktrees for automations that modify files
- Let users manually create worktrees for experimentation
- Track worktree lifecycle (creation, active use, cleanup)
- Provide Console UI for worktree visibility and management
- Ensure worktrees are cleaned up to prevent disk waste

## Decision

### 1. Architecture Overview

Worktree management is a **core worker service capability**, not an extension. It is project-scoped — each worktree belongs to a project's git repository.

```
Console UI (React)                Worker Service (Express)
┌────────────────────┐           ┌──────────────────────────┐
│  Worktrees Page    │◄─ IO ──►│  WorktreeManager          │
│  - Active list     │           │    create / remove       │
│  - Status badges   │── HTTP ──►│    status tracking       │
│  - Disk usage      │           │    cleanup policies      │
│  - Manage actions  │           │    git CLI wrapper        │
└────────────────────┘           └──────────────────────────┘
                                   │
                                   ▼
                                 git worktree add / remove / list
```

**Consumers:**
- **AutomationEngine** (ADR-050) — creates worktrees for automation runs with `worktree.enabled`
- **Chat sessions** (ADR-047, future) — optional worktree mode for chat-driven file modifications
- **Users** — manual creation via Console UI for experimentation or parallel work

### 2. Data Model

```typescript
interface Worktree {
  id: string;                     // UUID
  projectId: string;              // Owner project
  path: string;                   // Filesystem path (under worktree base dir)
  branch: string;                 // Checked-out branch
  baseBranch?: string;            // Branch it was created from (for new branches)
  status: WorktreeStatus;
  createdBy: WorktreeCreator;
  createdAt: string;              // ISO timestamp
  lastAccessedAt: string;         // Updated when automation/chat uses it
  diskUsageBytes?: number;        // Periodically updated
  cleanupPolicy: CleanupPolicy;
  metadata?: Record<string, string>;  // Flexible key-value (e.g., automationId, runId)
}

type WorktreeStatus =
  | "creating"        // git worktree add in progress
  | "ready"           // Available for use
  | "in_use"          // Currently being used by an automation run or chat
  | "completed"       // Work finished, retained for review
  | "error"           // Creation or operation failed
  | "removing";       // git worktree remove in progress

interface WorktreeCreator {
  type: "automation" | "chat" | "user";
  automationId?: string;          // If created by automation
  automationRunId?: string;       // Specific run
  chatSessionId?: string;         // If created by chat
}

type CleanupPolicy =
  | "always"          // Remove after use completes
  | "on_success"      // Remove only if the operation succeeded
  | "never"           // User must manually remove
  | "ttl";            // Auto-remove after TTL expires

interface WorktreeCreateOptions {
  projectId: string;
  branch: string;                 // Existing branch name or new branch name
  createBranch?: boolean;         // If true, creates a new branch from baseBranch
  baseBranch?: string;            // Base for new branch (default: current HEAD)
  cleanupPolicy: CleanupPolicy;
  ttlMs?: number;                 // For "ttl" policy (default: 24h)
  createdBy: WorktreeCreator;
  metadata?: Record<string, string>;
}
```

### 3. WorktreeManager

```typescript
// packages/worker-service/src/core/worktree-manager.ts

interface CleanupResult {
  removed: number;                // Number of worktrees removed
  freedBytes: number;             // Total disk freed
  errors: Array<{ worktreeId: string; error: string }>;  // Failed removals
}

class WorktreeManager {
  private db: Database;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(db: Database) { ... }

  // --- Lifecycle ---

  /** Start cleanup timer. Called at worker startup. */
  async start(): Promise<void>;

  /** Cancel timers, finalize pending operations. */
  async stop(): Promise<void>;

  // --- CRUD ---

  /**
   * Create a new git worktree.
   * Runs: git worktree add <path> <branch>
   * Or:   git worktree add -b <new-branch> <path> <base-branch>
   */
  async create(opts: WorktreeCreateOptions): Promise<Worktree>;

  /**
   * Remove a worktree and clean up its directory.
   * Runs: git worktree remove <path> --force
   * Only removes worktrees not currently in_use.
   */
  async remove(worktreeId: string): Promise<void>;

  /** List all worktrees for a project. */
  async list(projectId: string): Promise<Worktree[]>;

  /** Get worktree details. */
  async get(worktreeId: string): Promise<Worktree>;

  /** Update worktree status (used by AutomationEngine). */
  async setStatus(worktreeId: string, status: WorktreeStatus): Promise<void>;

  /** Mark worktree as actively in use (updates lastAccessedAt). */
  async markInUse(worktreeId: string): Promise<void>;

  /** Mark worktree as done, apply cleanup policy. */
  async markCompleted(worktreeId: string, success: boolean): Promise<void>;

  // --- Disk Management ---

  /** Calculate disk usage for a worktree. */
  async updateDiskUsage(worktreeId: string): Promise<number>;

  /** Get total disk usage across all worktrees for a project. */
  async totalDiskUsage(projectId: string): Promise<number>;

  // --- Cleanup ---

  /** Run periodic cleanup: TTL expiry, orphan detection, disk limits. */
  async runCleanup(): Promise<CleanupResult>;

  /** Detect worktrees on disk that aren't tracked in DB (orphans). */
  async detectOrphans(projectId: string): Promise<string[]>;

  /** Prune git's internal worktree tracking (git worktree prune). */
  async prune(projectId: string): Promise<void>;

  // --- Internal ---

  private resolveWorktreePath(projectId: string, branch: string): string;
  private execGit(projectPath: string, args: string[]): Promise<string>;
}
```

### 4. Worktree Path Convention

All worktrees are created under a deterministic base directory:

```
~/.renre-kit/worktrees/{project-id}/{worktree-id}/
```

This keeps worktrees out of the project directory itself and centralizes them for easy discovery and cleanup.

Example:
```
~/.renre-kit/worktrees/
  proj_abc123/
    wt_001/                      ← automation "Daily Code Review" run #47
    wt_002/                      ← user-created worktree for experimentation
  proj_def456/
    wt_003/                      ← chat session worktree
```

The git command executed:
```bash
git -C /Users/dev/my-app worktree add ~/.renre-kit/worktrees/proj_abc123/wt_001 main
```

### 5. SQLite Schema

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

CREATE INDEX idx_worktrees_project ON _worktrees(project_id);
CREATE INDEX idx_worktrees_status ON _worktrees(project_id, status);
CREATE INDEX idx_worktrees_automation ON _worktrees(created_by_automation_id);
CREATE INDEX idx_worktrees_cleanup ON _worktrees(cleanup_policy, status);
```

### 6. REST API

**Note**: Static routes (`/cleanup`, `/disk-usage`) must be registered **before** parameterized `/{id}` routes in Express to avoid matching `cleanup` as a worktree ID.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/{pid}/worktrees` | GET | List worktrees for project |
| `/api/{pid}/worktrees` | POST | Create a new worktree |
| `/api/{pid}/worktrees/cleanup` | POST | Trigger manual cleanup |
| `/api/{pid}/worktrees/disk-usage` | GET | Total disk usage for project worktrees |
| `/api/{pid}/worktrees/{id}` | GET | Get worktree details |
| `/api/{pid}/worktrees/{id}` | DELETE | Remove a worktree |
| `/api/{pid}/worktrees/{id}/status` | GET | Get worktree status with disk usage |

### 7. Socket.IO Events

> **ADR-048 amendment**: The following `worktree:*` events must be added to ADR-048's `project:{projectId}` room definition, alongside existing project-scoped events (session, observation, tool, etc.).

```
room: "project:{projectId}"
  ├── worktree:created       { worktreeId, branch, path, createdByType }
  ├── worktree:status-changed { worktreeId, oldStatus, newStatus }
  ├── worktree:in-use        { worktreeId, automationRunId?, chatSessionId? }
  ├── worktree:completed     { worktreeId, success }
  ├── worktree:removed       { worktreeId }
  ├── worktree:error         { worktreeId, error }
  └── worktree:cleanup       { removed: number, freedBytes: number }
```

### 8. Console UI: Worktrees Page

Added to the sidebar as a core page. URL: `/:projectId/worktrees`.

#### 8.1 Worktree List View

```
┌─────────────────────────────────────────────────────────────────────┐
│  Worktrees                                        [+ New Worktree]  │
│  Total disk usage: 142 MB across 4 worktrees           [Cleanup]    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─ wt_001 ── main ──────────────────── IN USE ─────────────────┐  │
│  │  Created by: Automation "Daily Code Review" (Run #47)         │  │
│  │  Path: ~/.renre-kit/worktrees/proj_abc/wt_001                 │  │
│  │  Created: 2 min ago  │  Disk: 38 MB  │  Cleanup: on success   │  │
│  │  Status: Step 2/3 running...                                  │  │
│  │                                                    [View Run] │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ wt_002 ── feature/experiment ────── READY ──────────────────┐  │
│  │  Created by: User (manual)                                    │  │
│  │  Path: ~/.renre-kit/worktrees/proj_abc/wt_002                 │  │
│  │  Created: 3 hours ago  │  Disk: 52 MB  │  Cleanup: never      │  │
│  │                                      [Open Terminal] [Remove] │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ wt_003 ── fix/auth-bug ─────────── COMPLETED ──────────────┐  │
│  │  Created by: Automation "Bug Fix Assistant" (Run #12)         │  │
│  │  Path: ~/.renre-kit/worktrees/proj_abc/wt_003                 │  │
│  │  Completed: 1 day ago  │  Disk: 41 MB  │  Cleanup: never      │  │
│  │  Result: 3 files modified, 1 commit created                   │  │
│  │                              [View Changes] [Merge] [Remove]  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ wt_004 ── main ─────────────────── ERROR ──────────────────┐   │
│  │  Created by: Automation "Nightly Audit" (Run #8)              │  │
│  │  Error: "Branch 'main' is already checked out at..."          │  │
│  │  Created: 5 hours ago  │  Disk: 0 MB                          │  │
│  │                                            [Retry] [Remove]   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 8.2 Create Worktree Dialog

```
┌─────────────────────────────────────────────────────────┐
│  Create Worktree                                   [X]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ( ) Use existing branch                                │
│  (●) Create new branch                                  │
│                                                         │
│  Branch name: [feature/my-experiment  ]                  │
│  Base branch: [main ▼]                                   │
│                                                         │
│  Cleanup policy:                                        │
│  ( ) Always — auto-remove when done                     │
│  ( ) On success — keep on failure for debugging         │
│  (●) Never — manual cleanup                             │
│  ( ) TTL — auto-remove after [24] hours                  │
│                                                         │
│                              [Cancel]  [Create Worktree] │
└─────────────────────────────────────────────────────────┘
```

#### 8.3 Worktree Detail / Actions

For **completed worktrees** with changes, the UI provides:

| Action | Description |
|--------|-------------|
| **View Changes** | Shows `git diff` of modifications made in the worktree |
| **Open Terminal** | Copies the worktree path for terminal use |
| **Merge** | Merges worktree branch changes back into a target branch (confirmation required) |
| **Create PR** | Opens a GitHub PR creation flow from the worktree branch |
| **Remove** | Deletes the worktree and cleans up disk (confirmation if changes exist) |

For **in-use worktrees**, the UI shows live status from the automation run or chat session, linking to the run detail view (ADR-050) or chat session.

#### 8.4 Status Badges

| Status | Badge | Color | Description |
|--------|-------|-------|-------------|
| `creating` | CREATING | gray | `git worktree add` in progress |
| `ready` | READY | blue | Available, not currently in use |
| `in_use` | IN USE | green (animated) | Automation or chat is actively working |
| `completed` | COMPLETED | green | Work done, retained for review |
| `error` | ERROR | red | Creation or operation failed |
| `removing` | REMOVING | gray | `git worktree remove` in progress |

### 9. Cleanup Policies & Disk Management

#### 9.1 Automatic Cleanup

A cleanup job runs every **hour** (configurable):

```typescript
async runCleanup(): Promise<CleanupResult> {
  // 1. TTL expiry: remove worktrees past their TTL
  const expired = db.prepare(`
    SELECT * FROM _worktrees
    WHERE cleanup_policy = 'ttl'
      AND status IN ('ready', 'completed')
      AND created_at < datetime('now', '-' || (ttl_ms / 1000) || ' seconds')
  `).all();

  // 2. Orphan detection: worktrees on disk not tracked in DB
  const orphans = await this.detectOrphans(projectId);

  // 3. Disk limit: if total > maxWorktreeDiskMb, remove oldest completed
  const totalDisk = await this.totalDiskUsage(projectId);
  if (totalDisk > config.maxWorktreeDiskBytes) {
    // Remove oldest "completed" worktrees until under limit
  }

  // 4. Stale in_use: worktrees marked in_use but last accessed > staleTimeoutMs
  //    (automation or chat crashed without cleanup)
  const stale = db.prepare(`
    SELECT * FROM _worktrees
    WHERE status = 'in_use'
      AND last_accessed_at < datetime('now', '-' || (? / 1000) || ' seconds')
  `).all(config.staleTimeoutMs);
  // Mark stale worktrees as "error" (not "completed") — they were abandoned
  // by a crashed automation, so their state is unknown/unreliable
  for (const wt of stale) {
    db.prepare(`UPDATE _worktrees SET status = 'error', error = 'Stale: owner process did not clean up' WHERE id = ?`).run(wt.id);
    // Emit Socket.IO: worktree:status-changed { worktreeId, oldStatus: "in_use", newStatus: "error" }
  }

  // 5. git worktree prune (cleans git's internal tracking)
  await this.prune(projectId);

  return { removed: expired.length + orphans.length, freedBytes };
}
```

#### 9.2 Startup Reconciliation

When the worker starts (or restarts after a crash), `WorktreeManager.start()` runs **immediately** — not deferred to the hourly cleanup:

```typescript
async start(): Promise<void> {
  // 1. Mark all "in_use" worktrees as "error" — the owner process is gone
  //    (AutomationEngine.start() separately marks those runs as "failed")
  const abandoned = this.db.prepare(`
    UPDATE _worktrees SET status = 'error',
      error = 'Worker restarted while worktree was in use'
    WHERE status = 'in_use'
  `).run();
  if (abandoned.changes > 0) {
    this.logger.warn(`Marked ${abandoned.changes} abandoned worktrees as error`);
  }

  // 2. Mark "creating" / "removing" worktrees as "error" — interrupted mid-operation
  this.db.prepare(`
    UPDATE _worktrees SET status = 'error',
      error = 'Worker restarted during worktree operation'
    WHERE status IN ('creating', 'removing')
  `).run();

  // 3. Detect orphans: directories on disk not tracked in DB
  const projects = this.db.prepare(`SELECT DISTINCT project_id FROM _worktrees`).all();
  for (const { project_id } of projects) {
    const orphans = await this.detectOrphans(project_id);
    for (const orphanPath of orphans) {
      this.logger.warn(`Removing orphan worktree: ${orphanPath}`);
      await this.execGit(orphanPath, ["worktree", "remove", orphanPath, "--force"]).catch(() => {
        // If git remove fails, try filesystem cleanup
        fs.rmSync(orphanPath, { recursive: true, force: true });
      });
    }
  }

  // 4. git worktree prune for all projects
  for (const { project_id } of projects) {
    await this.prune(project_id);
  }

  // 5. Start periodic cleanup timer
  this.cleanupTimer = setInterval(() => this.runCleanup(), config.cleanupIntervalMs);
}
```

This ensures no worktrees are left in inconsistent states after crashes. Error-state worktrees appear in the Console UI for user review (retry or remove).

#### 9.3 Configuration

```json
// ~/.renre-kit/config.json
{
  "worktrees": {
    "basePath": "~/.renre-kit/worktrees",
    "maxWorktreeDiskMb": 500,
    "defaultTtlMs": 86400000,
    "cleanupIntervalMs": 3600000,
    "staleTimeoutMs": 7200000
  }
}
```

| Config | Default | Description |
|--------|---------|-------------|
| `basePath` | `~/.renre-kit/worktrees` | Root directory for all worktrees |
| `maxWorktreeDiskMb` | 500 | Max total disk for worktrees per project |
| `defaultTtlMs` | 86400000 (24h) | Default TTL for `ttl` cleanup policy |
| `cleanupIntervalMs` | 3600000 (1h) | How often the cleanup job runs |
| `staleTimeoutMs` | 7200000 (2h) | Mark `in_use` worktrees as stale after this |

### 10. Git Worktree Constraints

Git imposes constraints that the WorktreeManager must handle:

| Constraint | Handling |
|------------|----------|
| **Cannot checkout same branch in two worktrees** | WorktreeManager checks before creation; returns error with a clear message ("Branch 'main' is already checked out at /path"). **For automation-created worktrees** (`createdBy.type === "automation"`), WorktreeManager **automatically generates** a unique branch name: `renre-auto/{automation-name}/{base-branch}-{unix-timestamp}` (e.g., `renre-auto/daily-review/main-1709971200`). The caller (AutomationEngine) does not need to handle naming — WorktreeManager detects the `automation` creator type and applies auto-naming. |
| **Worktree must be in a git repo** | `create()` verifies project path is a git repo before proceeding |
| **Nested worktrees not supported** | `resolveWorktreePath()` places worktrees under `~/.renre-kit/worktrees/`, never inside another worktree |
| **Uncommitted changes on remove** | `remove()` with `--force` flag; warns user via Socket.IO if changes detected before removal |
| **Detached HEAD worktrees** | Not supported in v1 — always require a branch name |

### 11. Integration with AutomationEngine (ADR-050)

When an automation has `worktree.enabled`:

```typescript
// Inside AutomationEngine.executeChain()

if (automation.worktree?.enabled) {
  // 1. Create worktree
  //    WorktreeManager auto-generates branch name for automation-created worktrees
  //    (see §10 — branch constraint handling)
  const targetBranch = automation.worktree.branch ?? await getCurrentBranch(projectPath);
  const wt = await this.worktreeManager.create({
    projectId: automation.projectId,
    branch: targetBranch,
    createBranch: true,
    baseBranch: targetBranch,
    cleanupPolicy: automation.worktree.cleanup,
    ttlMs: automation.worktree.ttlMs,
    createdBy: {
      type: "automation",
      automationId: automation.id,
      automationRunId: runId,
    },
  });

  // 2. Set CWD for all tool executions to worktree path
  executionContext.cwd = wt.path;

  // 3. Make worktree path available as template variable
  templateVars["worktree.path"] = wt.path;
  templateVars["worktree.branch"] = wt.branch;

  // 4. Mark in use
  await this.worktreeManager.markInUse(wt.id);

  try {
    // ... execute chain steps with CWD = worktree path ...

    // 5. Mark completed, apply cleanup
    await this.worktreeManager.markCompleted(wt.id, runSuccess);
  } catch (err) {
    // 6. On failure: set worktree status to "error", not "completed"
    await this.worktreeManager.setStatus(wt.id, "error");
    // Cleanup policy "on_success" → retain (failure → keep for debugging)
    // Cleanup policy "always" → still remove
    if (automation.worktree.cleanup === "always") {
      await this.worktreeManager.remove(wt.id);
    }
    throw err;
  }
}
```

### 12. Sidebar & Navigation

> **ADR-024 amendment**: Worktrees is added as a core sidebar page. ADR-024's sidebar structure must be updated to include Chat, Automations, and Worktrees between Dashboard and extension pages.

```
Dashboard
Chat                             ← ADR-047
Automations                      ← ADR-050
Worktrees                        ← NEW (this ADR)
────────────────
Jira (extension pages)
GitHub MCP (extension pages)
────────────────
Extension Manager
Logs
```

### 13. Security Considerations

- **Path traversal**: `resolveWorktreePath()` validates that the resolved path is under the configured `basePath`. Rejects any path containing `..` or symlinks that escape the base directory.
- **Disk exhaustion**: `maxWorktreeDiskMb` limit per project. Cleanup job enforces the limit by removing oldest completed worktrees first.
- **Git credential exposure**: Worktrees share the same `.git` directory and credentials as the main checkout. No additional credential surface.
- **Extension access**: Extensions do NOT have direct access to `WorktreeManager`. They cannot create, remove, or access worktrees. Only core features (AutomationEngine, CopilotBridge) can use worktrees.

## Consequences

### Positive
- **File isolation** — automations and chat can modify files without affecting the user's active checkout
- **Parallel work** — multiple automations can work on different branches simultaneously
- **Safe experimentation** — users can create worktrees for throwaway exploration
- **Centralized management** — Console UI provides visibility and control over all worktrees
- **Automatic cleanup** — TTL, disk limits, and stale detection prevent worktree sprawl
- **Git-native** — leverages `git worktree` which shares object storage (no full repo clone needed)

### Negative
- **Disk usage** — each worktree is a full working copy (minus shared `.git` objects). Large repos can consume significant disk.
- **Git version dependency** — requires git 2.5+ for worktree support (widely available)
- **Branch checkout constraint** — git doesn't allow the same branch checked out in two worktrees simultaneously. WorktreeManager must handle this.
- **Complexity** — adds lifecycle management, cleanup, and UI for a git feature most users don't use directly

### Mitigations
- **Disk limits** enforced via config (`maxWorktreeDiskMb: 500`)
- **Automatic cleanup** with configurable policies (TTL, on_success, always)
- **Branch auto-naming** for automation worktrees avoids checkout conflicts
- **Console UI** makes worktree management accessible without git CLI knowledge
- **Stale detection** catches worktrees left behind by crashed automations

### Risks
- **Large monorepos** — worktrees in huge repos (e.g., 10GB+) could be slow to create and consume significant disk. Mitigated: `git worktree add` is faster than `git clone` (shared objects), and disk limits prevent unbounded growth.
- **Git lock contention** — concurrent git operations across main checkout and worktrees can cause lock conflicts on `.git/index.lock`. Mitigated: worktree operations are serialized per project in WorktreeManager, and git worktrees have separate index files.
- **Submodule edge cases** — git worktrees and submodules have known quirks. Mitigated: v1 does not explicitly handle submodules; documented as a known limitation.

## Alternatives Considered

1. **Full git clone instead of worktree** — Rejected: wastes disk (copies all objects), slower, more complex cleanup
2. **Temporary directory with `git checkout-index`** — Rejected: doesn't provide full git history access for tools that need it
3. **Container/sandbox per automation** — Deferred: heavier than worktrees for the common case; consider for v2 if stronger isolation needed
4. **No isolation (just work in main checkout)** — Rejected: conflicts with user's active work, risky for automated file modifications

## References

- ADR-050: Automations — worktree config in automation definitions, startup reconciliation
- ADR-047: Console Chat UI — future worktree mode for chat sessions
- ADR-024: Console UI Pages — **amended**: sidebar structure updated with Worktrees as core page
- ADR-048: Socket.IO Real-Time Communication — **amended**: adds `worktree:*` events to project room
- [git-worktree documentation](https://git-scm.com/docs/git-worktree)
