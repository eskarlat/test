import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as pathResolve } from "node:path";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { Server as SocketIOServer } from "socket.io";
import { logger } from "./logger.js";
import { globalPaths } from "./paths.js";
import { getRegistry as getProjectRegistry } from "../routes/projects.js";

// ---------------------------------------------------------------------------
// Types (Task 1.2)
// ---------------------------------------------------------------------------

export type WorktreeStatus =
  | "creating"
  | "ready"
  | "in_use"
  | "completed"
  | "error"
  | "removing";

export type CleanupPolicy = "always" | "on_success" | "never" | "ttl";

export interface WorktreeCreator {
  type: "automation" | "chat" | "user";
  automationId?: string;
  automationRunId?: string;
  chatSessionId?: string;
}

export interface Worktree {
  id: string;
  projectId: string;
  path: string;
  branch: string;
  baseBranch?: string;
  status: WorktreeStatus;
  createdBy: WorktreeCreator;
  createdAt: string;
  lastAccessedAt: string;
  completedAt?: string;
  error?: string;
  diskUsageBytes?: number;
  cleanupPolicy: CleanupPolicy;
  ttlMs?: number;
  metadata?: Record<string, unknown>;
}

export interface WorktreeCreateOptions {
  projectId: string;
  branch?: string;
  createBranch?: boolean;
  baseBranch?: string;
  cleanupPolicy: CleanupPolicy;
  ttlMs?: number;
  createdBy: WorktreeCreator;
  metadata?: Record<string, unknown>;
}

export interface CleanupResult {
  removed: number;
  freedBytes: number;
  errors: Array<{ worktreeId: string; error: string }>;
}

// ---------------------------------------------------------------------------
// DB Row shape
// ---------------------------------------------------------------------------

interface WorktreeRow {
  id: string;
  project_id: string;
  path: string;
  branch: string;
  base_branch: string | null;
  status: string;
  created_by_type: string;
  created_by_automation_id: string | null;
  created_by_automation_run_id: string | null;
  created_by_chat_session_id: string | null;
  cleanup_policy: string;
  ttl_ms: number | null;
  disk_usage_bytes: number | null;
  metadata_json: string | null;
  created_at: string;
  last_accessed_at: string;
  completed_at: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Configuration (Task 1.8)
// ---------------------------------------------------------------------------

interface WorktreeConfig {
  basePath: string;
  maxWorktreeDiskMb: number;
  maxWorktreeDiskBytes: number;
  defaultTtlMs: number;
  cleanupIntervalMs: number;
  staleTimeoutMs: number;
}

const WORKTREE_DEFAULTS = {
  basePath: join(homedir(), ".renre-kit", "worktrees"),
  maxWorktreeDiskMb: 500,
  defaultTtlMs: 86400000,      // 24h
  cleanupIntervalMs: 3600000,  // 1h
  staleTimeoutMs: 7200000,     // 2h
};

function readConfigOverrides(): Record<string, unknown> | null {
  try {
    const { configFile } = globalPaths();
    if (!existsSync(configFile)) return null;
    const raw = JSON.parse(readFileSync(configFile, "utf8")) as Record<string, unknown>;
    const overrides = raw["worktrees"];
    return (overrides && typeof overrides === "object") ? overrides as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function applyOverride<T>(overrides: Record<string, unknown>, key: string, expectedType: string): T | undefined {
  const val = overrides[key];
  return typeof val === expectedType ? val as T : undefined;
}

function loadWorktreeConfig(): WorktreeConfig {
  const defaults = { ...WORKTREE_DEFAULTS };
  const overrides = readConfigOverrides();
  if (overrides) {
    defaults.basePath = applyOverride<string>(overrides, "basePath", "string") ?? defaults.basePath;
    defaults.maxWorktreeDiskMb = applyOverride<number>(overrides, "maxWorktreeDiskMb", "number") ?? defaults.maxWorktreeDiskMb;
    defaults.defaultTtlMs = applyOverride<number>(overrides, "defaultTtlMs", "number") ?? defaults.defaultTtlMs;
    defaults.cleanupIntervalMs = applyOverride<number>(overrides, "cleanupIntervalMs", "number") ?? defaults.cleanupIntervalMs;
    defaults.staleTimeoutMs = applyOverride<number>(overrides, "staleTimeoutMs", "number") ?? defaults.staleTimeoutMs;
  }
  return {
    ...defaults,
    maxWorktreeDiskBytes: defaults.maxWorktreeDiskMb * 1024 * 1024,
  };
}

// ---------------------------------------------------------------------------
// WorktreeManager (Tasks 1.3 - 1.8)
// ---------------------------------------------------------------------------

const SRC = "worktree-manager";

export class WorktreeManager {
  private readonly db: Database.Database;
  private readonly io: SocketIOServer;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly config: WorktreeConfig;

  constructor(db: Database.Database, io: SocketIOServer) {
    this.db = db;
    this.io = io;
    this.config = loadWorktreeConfig();
  }

  // -----------------------------------------------------------------------
  // Lifecycle (Task 1.3)
  // -----------------------------------------------------------------------

  async start(): Promise<void> {
    logger.info(SRC, "Starting worktree manager — running startup reconciliation");

    this.reconcileInterruptedWorktrees();
    await this.reconcileOrphansForAllProjects();
    this.startCleanupTimer();

    logger.info(SRC, "Worktree manager started");
  }

  private reconcileInterruptedWorktrees(): void {
    // 1. Mark all in_use worktrees as error
    const inUseCount = this.db
      .prepare(
        "UPDATE _worktrees SET status = 'error', error = ? WHERE status = 'in_use'",
      )
      .run("Worker restarted while worktree was in use").changes;
    if (inUseCount > 0) {
      logger.warn(SRC, `Marked ${inUseCount} in_use worktree(s) as error (worker restart)`);
    }

    // 2. Mark all creating/removing worktrees as error
    const pendingCount = this.db
      .prepare(
        "UPDATE _worktrees SET status = 'error', error = ? WHERE status IN ('creating', 'removing')",
      )
      .run("Worker restarted during operation").changes;
    if (pendingCount > 0) {
      logger.warn(SRC, `Marked ${pendingCount} creating/removing worktree(s) as error (worker restart)`);
    }
  }

  private async reconcileOrphansForAllProjects(): Promise<void> {
    const projectIds = this.getAllKnownProjectIds();
    for (const projectId of projectIds) {
      try {
        await this.reconcileProjectOrphans(projectId);
        await this.prune(projectId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(SRC, `Reconciliation failed for project ${projectId}: ${msg}`);
      }
    }
  }

  private async reconcileProjectOrphans(projectId: string): Promise<void> {
    const orphans = await this.detectOrphans(projectId);
    for (const orphanPath of orphans) {
      await this.removeOrphanDirectory(projectId, orphanPath);
    }
  }

  private async removeOrphanDirectory(projectId: string, orphanPath: string): Promise<void> {
    logger.warn(SRC, `Removing orphan worktree directory: ${orphanPath}`);
    try {
      const projectPath = this.getProjectPath(projectId);
      if (projectPath) {
        await this.execGit(projectPath, ["worktree", "remove", "--force", orphanPath]);
        return;
      }
    } catch {
      // Fall through to fs removal
    }
    try {
      rmSync(orphanPath, { recursive: true, force: true });
    } catch (fsErr) {
      const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
      logger.error(SRC, `Failed to remove orphan directory ${orphanPath}: ${msg}`);
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.runCleanup().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(SRC, `Periodic cleanup failed: ${msg}`);
      });
    }, this.config.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    logger.info(SRC, "Worktree manager stopped");
  }

  // -----------------------------------------------------------------------
  // CRUD Operations (Task 1.4)
  // -----------------------------------------------------------------------

  async create(opts: WorktreeCreateOptions): Promise<Worktree> {
    const projectPath = this.getProjectPath(opts.projectId);
    if (!projectPath) {
      throw new Error(`Project ${opts.projectId} not found in registry`);
    }

    // 1. Verify project path is a git repo
    try {
      await this.execGit(projectPath, ["rev-parse", "--git-dir"]);
    } catch {
      throw new Error(`Project path is not a git repository: ${projectPath}`);
    }

    // 2. Generate UUID
    const worktreeId = crypto.randomUUID();

    // 3. Resolve worktree path
    const worktreePath = this.resolveWorktreePath(opts.projectId, worktreeId);

    // 4. Auto-branch naming for automation-created worktrees
    let branch = opts.branch;
    let createBranch = opts.createBranch ?? false;

    if (opts.createdBy.type === "automation" && !branch) {
      const automationName = this.lookupAutomationName(opts.createdBy.automationId);
      const baseBranch = opts.baseBranch ?? "main";
      const timestamp = Math.floor(Date.now() / 1000);
      branch = `renre-auto/${automationName}/${baseBranch}-${timestamp}`;
      createBranch = true;
    }

    if (!branch) {
      throw new Error("Branch name is required (or use automation type for auto-naming)");
    }

    // 5. Branch checkout constraint — check if branch is already checked out
    if (!createBranch) {
      try {
        const porcelainOutput = await this.execGit(projectPath, ["worktree", "list", "--porcelain"]);
        const lines = porcelainOutput.split("\n");
        for (const line of lines) {
          if (line.startsWith("branch refs/heads/") && line === `branch refs/heads/${branch}`) {
            throw new Error(
              `Branch "${branch}" is already checked out in another worktree. ` +
              `Git does not allow the same branch in multiple worktrees.`,
            );
          }
        }
      } catch (err) {
        // Re-throw if it's our branch conflict error
        if (err instanceof Error && err.message.includes("already checked out")) {
          throw err;
        }
        // Ignore other git errors (e.g., no worktrees yet)
      }
    }

    // 6. Insert DB record with status creating
    const now = new Date().toISOString();
    const metadataJson = opts.metadata ? JSON.stringify(opts.metadata) : null;

    this.db
      .prepare(
        `INSERT INTO _worktrees (
          id, project_id, path, branch, base_branch, status,
          created_by_type, created_by_automation_id, created_by_automation_run_id,
          created_by_chat_session_id, cleanup_policy, ttl_ms,
          metadata_json, created_at, last_accessed_at
        ) VALUES (?, ?, ?, ?, ?, 'creating', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        worktreeId,
        opts.projectId,
        worktreePath,
        branch,
        opts.baseBranch ?? null,
        opts.createdBy.type,
        opts.createdBy.automationId ?? null,
        opts.createdBy.automationRunId ?? null,
        opts.createdBy.chatSessionId ?? null,
        opts.cleanupPolicy,
        opts.ttlMs ?? null,
        metadataJson,
        now,
        now,
      );

    // 7. Execute git worktree add
    try {
      mkdirSync(join(this.config.basePath, opts.projectId), { recursive: true });

      if (createBranch) {
        const baseBranch = opts.baseBranch ?? "HEAD";
        await this.execGit(projectPath, [
          "worktree", "add", "-b", branch, worktreePath, baseBranch,
        ]);
      } else {
        await this.execGit(projectPath, [
          "worktree", "add", worktreePath, branch,
        ]);
      }

      // 8. Update status to ready
      this.db
        .prepare("UPDATE _worktrees SET status = 'ready' WHERE id = ?")
        .run(worktreeId);

      // 9. Emit worktree:created
      this.io.to(`project:${opts.projectId}`).emit("worktree:created", {
        worktreeId,
        projectId: opts.projectId,
        branch,
        path: worktreePath,
      });

      logger.info(SRC, `Worktree created: ${worktreeId} (branch: ${branch})`);
    } catch (err) {
      // 10. On error: update status and emit error
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.db
        .prepare("UPDATE _worktrees SET status = 'error', error = ? WHERE id = ?")
        .run(errorMsg, worktreeId);

      this.io.to(`project:${opts.projectId}`).emit("worktree:error", {
        worktreeId,
        projectId: opts.projectId,
        error: errorMsg,
      });

      logger.error(SRC, `Failed to create worktree ${worktreeId}: ${errorMsg}`);
      throw new Error(`Failed to create worktree: ${errorMsg}`);
    }

    // 11. Return Worktree object
    return this.get(worktreeId);
  }

  async remove(worktreeId: string): Promise<void> {
    // 1. Get worktree from DB
    const worktree = this.get(worktreeId);

    // 2. Reject if in_use
    if (worktree.status === "in_use") {
      throw new Error(`Cannot remove worktree ${worktreeId}: currently in use`);
    }

    // 3. Update status to removing
    this.db
      .prepare("UPDATE _worktrees SET status = 'removing' WHERE id = ?")
      .run(worktreeId);

    try {
      // 4. Check for uncommitted changes
      if (existsSync(worktree.path)) {
        try {
          const statusOutput = await this.execGit(worktree.path, ["status", "--porcelain"]);
          if (statusOutput.trim().length > 0) {
            this.io.to(`project:${worktree.projectId}`).emit("worktree:warning", {
              worktreeId,
              projectId: worktree.projectId,
              message: "Worktree has uncommitted changes that will be lost",
            });
            logger.warn(SRC, `Worktree ${worktreeId} has uncommitted changes`);
          }
        } catch {
          // Ignore status check failures
        }
      }

      // 5. Execute git worktree remove
      const projectPath = this.getProjectPath(worktree.projectId);
      if (projectPath) {
        try {
          await this.execGit(projectPath, ["worktree", "remove", "--force", worktree.path]);
        } catch {
          // Fallback to fs removal if git worktree remove fails
          if (existsSync(worktree.path)) {
            rmSync(worktree.path, { recursive: true, force: true });
          }
        }
      } else if (existsSync(worktree.path)) {
        rmSync(worktree.path, { recursive: true, force: true });
      }

      // 6. Delete DB record
      this.db.prepare("DELETE FROM _worktrees WHERE id = ?").run(worktreeId);

      // 7. Emit worktree:removed
      this.io.to(`project:${worktree.projectId}`).emit("worktree:removed", {
        worktreeId,
        projectId: worktree.projectId,
      });

      logger.info(SRC, `Worktree removed: ${worktreeId}`);
    } catch (err) {
      // 8. On error: set status to error
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.db
        .prepare("UPDATE _worktrees SET status = 'error', error = ? WHERE id = ?")
        .run(errorMsg, worktreeId);

      logger.error(SRC, `Failed to remove worktree ${worktreeId}: ${errorMsg}`);
      throw err;
    }
  }

  list(projectId: string): Worktree[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM _worktrees WHERE project_id = ? ORDER BY created_at DESC",
      )
      .all(projectId) as WorktreeRow[];

    return rows.map((row) => this.mapRowToWorktree(row));
  }

  get(worktreeId: string): Worktree {
    const row = this.db
      .prepare("SELECT * FROM _worktrees WHERE id = ?")
      .get(worktreeId) as WorktreeRow | undefined;

    if (!row) {
      throw new Error(`Worktree not found: ${worktreeId}`);
    }

    return this.mapRowToWorktree(row);
  }

  async setStatus(worktreeId: string, status: WorktreeStatus, error?: string): Promise<void> {
    const worktree = this.get(worktreeId);
    const oldStatus = worktree.status;

    if (error !== undefined) {
      this.db
        .prepare("UPDATE _worktrees SET status = ?, error = ? WHERE id = ?")
        .run(status, error, worktreeId);
    } else {
      this.db
        .prepare("UPDATE _worktrees SET status = ? WHERE id = ?")
        .run(status, worktreeId);
    }

    this.io.to(`project:${worktree.projectId}`).emit("worktree:status-changed", {
      worktreeId,
      projectId: worktree.projectId,
      oldStatus,
      newStatus: status,
    });
  }

  async markInUse(worktreeId: string): Promise<void> {
    const now = new Date().toISOString();

    this.db
      .prepare(
        "UPDATE _worktrees SET status = 'in_use', last_accessed_at = ? WHERE id = ?",
      )
      .run(now, worktreeId);

    const row = this.db
      .prepare(
        "SELECT project_id, created_by_automation_run_id, created_by_chat_session_id FROM _worktrees WHERE id = ?",
      )
      .get(worktreeId) as {
        project_id: string;
        created_by_automation_run_id: string | null;
        created_by_chat_session_id: string | null;
      } | undefined;

    if (row) {
      this.io.to(`project:${row.project_id}`).emit("worktree:in-use", {
        worktreeId,
        automationRunId: row.created_by_automation_run_id ?? undefined,
        chatSessionId: row.created_by_chat_session_id ?? undefined,
      });
    }
  }

  async markCompleted(worktreeId: string, success: boolean): Promise<void> {
    const now = new Date().toISOString();
    const worktree = this.get(worktreeId);

    // 1. Update status to completed
    this.db
      .prepare(
        "UPDATE _worktrees SET status = 'completed', completed_at = ? WHERE id = ?",
      )
      .run(now, worktreeId);

    // 2. Emit worktree:completed
    this.io.to(`project:${worktree.projectId}`).emit("worktree:completed", {
      worktreeId,
      projectId: worktree.projectId,
      success,
    });

    logger.info(SRC, `Worktree completed: ${worktreeId} (success: ${success})`);

    // 3. Apply cleanup policy
    const { cleanupPolicy } = worktree;
    if (cleanupPolicy === "always" || (cleanupPolicy === "on_success" && success)) {
      await this.remove(worktreeId);
    }
    // "on_success" + failure: retain for debugging
    // "never": retain
    // "ttl": retain, runCleanup() handles expiry
  }

  // -----------------------------------------------------------------------
  // Disk Management (Task 1.5)
  // -----------------------------------------------------------------------

  async updateDiskUsage(worktreeId: string): Promise<number> {
    const worktree = this.get(worktreeId);
    const bytes = calculateDirectorySize(worktree.path);

    this.db
      .prepare("UPDATE _worktrees SET disk_usage_bytes = ? WHERE id = ?")
      .run(bytes, worktreeId);

    return bytes;
  }

  totalDiskUsage(projectId: string): number {
    const row = this.db
      .prepare(
        "SELECT SUM(disk_usage_bytes) as total FROM _worktrees WHERE project_id = ?",
      )
      .get(projectId) as { total: number | null } | undefined;

    return row?.total ?? 0;
  }

  // -----------------------------------------------------------------------
  // Cleanup (Task 1.6)
  // -----------------------------------------------------------------------

  async runCleanup(): Promise<CleanupResult> {
    const result: CleanupResult = { removed: 0, freedBytes: 0, errors: [] };

    // 1. TTL expiry
    const now = Date.now();
    const ttlRows = this.db
      .prepare(
        `SELECT * FROM _worktrees
         WHERE cleanup_policy = 'ttl'
         AND status IN ('ready', 'completed')
         AND ttl_ms IS NOT NULL`,
      )
      .all() as WorktreeRow[];

    for (const row of ttlRows) {
      const createdAt = new Date(row.created_at).getTime();
      const ttlMs = row.ttl_ms ?? this.config.defaultTtlMs;
      if (now - createdAt > ttlMs) {
        try {
          const bytes = row.disk_usage_bytes ?? 0;
          await this.remove(row.id);
          result.removed++;
          result.freedBytes += bytes;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push({ worktreeId: row.id, error: msg });
        }
      }
    }

    // 2. Orphan detection for all projects
    const projectIds = this.getAllKnownProjectIds();
    for (const projectId of projectIds) {
      try {
        const orphans = await this.detectOrphans(projectId);
        for (const orphanPath of orphans) {
          try {
            let bytes = 0;
            if (existsSync(orphanPath)) {
              bytes = calculateDirectorySize(orphanPath);
            }
            const projectPath = this.getProjectPath(projectId);
            if (projectPath) {
              try {
                await this.execGit(projectPath, ["worktree", "remove", "--force", orphanPath]);
              } catch {
                rmSync(orphanPath, { recursive: true, force: true });
              }
            } else {
              rmSync(orphanPath, { recursive: true, force: true });
            }
            result.removed++;
            result.freedBytes += bytes;
            logger.info(SRC, `Removed orphan worktree directory: ${orphanPath}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push({ worktreeId: `orphan:${orphanPath}`, error: msg });
          }
        }
      } catch {
        // Skip project if orphan detection fails
      }
    }

    // 3. Disk limit enforcement
    for (const projectId of projectIds) {
      const totalBytes = this.totalDiskUsage(projectId);
      if (totalBytes > this.config.maxWorktreeDiskBytes) {
        // Remove oldest completed worktrees until under limit
        const completedRows = this.db
          .prepare(
            `SELECT * FROM _worktrees
             WHERE project_id = ? AND status = 'completed'
             ORDER BY completed_at ASC`,
          )
          .all(projectId) as WorktreeRow[];

        let currentTotal = totalBytes;
        for (const row of completedRows) {
          if (currentTotal <= this.config.maxWorktreeDiskBytes) break;
          try {
            const bytes = row.disk_usage_bytes ?? 0;
            await this.remove(row.id);
            currentTotal -= bytes;
            result.removed++;
            result.freedBytes += bytes;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push({ worktreeId: row.id, error: msg });
          }
        }
      }
    }

    // 4. Stale in_use detection
    const staleRows = this.db
      .prepare(
        `SELECT * FROM _worktrees
         WHERE status = 'in_use'
         AND last_accessed_at IS NOT NULL`,
      )
      .all() as WorktreeRow[];

    for (const row of staleRows) {
      const lastAccessed = new Date(row.last_accessed_at).getTime();
      if (now - lastAccessed > this.config.staleTimeoutMs) {
        const errorMsg = "Stale: owner process did not clean up";
        this.db
          .prepare("UPDATE _worktrees SET status = 'error', error = ? WHERE id = ?")
          .run(errorMsg, row.id);

        this.io.to(`project:${row.project_id}`).emit("worktree:status-changed", {
          worktreeId: row.id,
          projectId: row.project_id,
          oldStatus: "in_use",
          newStatus: "error",
        });

        logger.warn(SRC, `Marked stale worktree as error: ${row.id}`);
      }
    }

    // 5. git worktree prune for all projects
    for (const projectId of projectIds) {
      try {
        await this.prune(projectId);
      } catch {
        // Ignore prune errors
      }
    }

    if (result.removed > 0 || result.errors.length > 0) {
      logger.info(
        SRC,
        `Cleanup complete: removed=${result.removed}, freedBytes=${result.freedBytes}, errors=${result.errors.length}`,
      );
      // Emit cleanup summary to all project rooms (ADR-051 §7)
      for (const projectId of projectIds) {
        this.io.to(`project:${projectId}`).emit("worktree:cleanup", {
          removed: result.removed,
          freedBytes: result.freedBytes,
        });
      }
    }

    return result;
  }

  async detectOrphans(projectId: string): Promise<string[]> {
    const projectDir = join(this.config.basePath, projectId);
    if (!existsSync(projectDir)) return [];

    let dirEntries: string[];
    try {
      dirEntries = readdirSync(projectDir);
    } catch {
      return [];
    }

    // Get all tracked worktree IDs for this project
    const trackedRows = this.db
      .prepare("SELECT id FROM _worktrees WHERE project_id = ?")
      .all(projectId) as Array<{ id: string }>;

    const trackedIds = new Set(trackedRows.map((r) => r.id));
    const orphans: string[] = [];

    for (const entry of dirEntries) {
      if (!trackedIds.has(entry)) {
        orphans.push(join(projectDir, entry));
      }
    }

    return orphans;
  }

  async prune(projectId: string): Promise<void> {
    const projectPath = this.getProjectPath(projectId);
    if (!projectPath) {
      logger.warn(SRC, `Cannot prune: project ${projectId} not found in registry`);
      return;
    }

    try {
      await this.execGit(projectPath, ["worktree", "prune"]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(SRC, `git worktree prune failed for project ${projectId}: ${msg}`);
    }
  }

  // -----------------------------------------------------------------------
  // Internal Helpers (Task 1.7)
  // -----------------------------------------------------------------------

  /** @internal — exposed for testing only */
  resolveWorktreePath(projectId: string, worktreeId: string): string {
    // Security: validate no path traversal components
    if (projectId.includes("..") || projectId.includes("/") || projectId.includes("\\")) {
      throw new Error("Invalid project ID: path traversal detected");
    }
    if (worktreeId.includes("..") || worktreeId.includes("/") || worktreeId.includes("\\")) {
      throw new Error("Invalid worktree ID: path traversal detected");
    }

    const resolved = join(this.config.basePath, projectId, worktreeId);

    // Verify the resolved path is under basePath
    const normalizedBase = pathResolve(this.config.basePath);
    const normalizedResolved = pathResolve(resolved);
    if (!normalizedResolved.startsWith(normalizedBase + "/") && normalizedResolved !== normalizedBase) {
      throw new Error("Security violation: resolved worktree path escapes base directory");
    }

    return resolved;
  }

  private execGit(projectPath: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", ["-C", projectPath, ...args], { // eslint-disable-line sonarjs/no-os-command-from-path
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", (err) => {
        reject(new Error(`Failed to spawn git: ${err.message}`));
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`git ${args.join(" ")} failed (exit ${code}): ${stderr.trim()}`));
        }
      });
    });
  }

  private getProjectPath(projectId: string): string | null {
    const registry = getProjectRegistry();
    const project = registry.get(projectId);
    return project?.path ?? null;
  }

  private mapRowToWorktree(row: WorktreeRow): Worktree {
    const createdBy: WorktreeCreator = {
      type: row.created_by_type as WorktreeCreator["type"],
    };
    if (row.created_by_automation_id) {
      createdBy.automationId = row.created_by_automation_id;
    }
    if (row.created_by_automation_run_id) {
      createdBy.automationRunId = row.created_by_automation_run_id;
    }
    if (row.created_by_chat_session_id) {
      createdBy.chatSessionId = row.created_by_chat_session_id;
    }

    let metadata: Record<string, unknown> | undefined;
    if (row.metadata_json) {
      try {
        metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
      } catch {
        // Invalid JSON — leave metadata undefined
      }
    }

    const worktree: Worktree = {
      id: row.id,
      projectId: row.project_id,
      path: row.path,
      branch: row.branch,
      status: row.status as WorktreeStatus,
      createdBy,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      cleanupPolicy: row.cleanup_policy as CleanupPolicy,
    };

    if (row.base_branch !== null) worktree.baseBranch = row.base_branch;
    if (row.completed_at !== null) worktree.completedAt = row.completed_at;
    if (row.error !== null) worktree.error = row.error;
    if (row.disk_usage_bytes !== null) worktree.diskUsageBytes = row.disk_usage_bytes;
    if (row.ttl_ms !== null) worktree.ttlMs = row.ttl_ms;
    if (metadata !== undefined) worktree.metadata = metadata;

    return worktree;
  }

  private lookupAutomationName(automationId?: string): string {
    if (!automationId) return "unknown";

    try {
      const row = this.db
        .prepare("SELECT name FROM _automations WHERE id = ?")
        .get(automationId) as { name: string } | undefined;
      return row?.name ?? "unknown";
    } catch {
      // _automations table may not exist yet — return fallback
      return "unknown";
    }
  }

  private getAllKnownProjectIds(): string[] {
    // Gather project IDs from both the DB and the in-memory registry
    const ids = new Set<string>();

    // From DB worktrees table
    try {
      const rows = this.db
        .prepare("SELECT DISTINCT project_id FROM _worktrees")
        .all() as Array<{ project_id: string }>;
      for (const row of rows) {
        ids.add(row.project_id);
      }
    } catch {
      // Table might not exist yet
    }

    // From project registry
    const registry = getProjectRegistry();
    for (const [id] of registry) {
      ids.add(id);
    }

    return Array.from(ids);
  }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function calculateDirectorySize(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;

  let totalSize = 0;

  function walk(currentPath: string): void {
    let entries: string[];
    try {
      entries = readdirSync(currentPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry);
      try {
        const stats = lstatSync(fullPath);
        if (stats.isFile()) {
          totalSize += stats.size;
        } else if (stats.isDirectory() && !stats.isSymbolicLink()) {
          walk(fullPath);
        }
      } catch {
        // Skip files we can't stat (permissions, etc.)
      }
    }
  }

  walk(dirPath);
  return totalSize;
}
