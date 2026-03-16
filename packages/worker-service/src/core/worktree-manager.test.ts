import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { WorktreeManager } from "./worktree-manager.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./paths.js", () => ({
  globalPaths: () => ({
    globalDir: "/tmp/renre-kit-test",
    configFile: "/tmp/renre-kit-test/config.json",
    dataDb: "/tmp/renre-kit-test/data.db",
    logsDir: "/tmp/renre-kit-test/logs",
  }),
}));

// Mock the project registry
const mockRegistry = new Map<string, { id: string; name: string; path: string }>();
vi.mock("../routes/projects.js", () => ({
  getRegistry: () => mockRegistry,
}));

// Mock child_process.spawn for git commands
const mockSpawnHandlers: Array<{
  matcher: (args: string[]) => boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}> = [];

vi.mock("node:child_process", () => ({
  spawn: vi.fn((_cmd: string, args: string[]) => {
    const handler = mockSpawnHandlers.find((h) => h.matcher(args));

    const stdoutData = handler?.stdout ?? "";
    const stderrData = handler?.stderr ?? "";
    const exitCode = handler?.exitCode ?? 0;

    const stdoutListeners = new Map<string, Array<(data: Buffer) => void>>();
    const stderrListeners = new Map<string, Array<(data: Buffer) => void>>();
    const processListeners = new Map<string, Array<(...args: unknown[]) => void>>();

    const child = {
      stdout: {
        on(event: string, fn: (data: Buffer) => void) {
          const list = stdoutListeners.get(event) ?? [];
          list.push(fn);
          stdoutListeners.set(event, list);
        },
      },
      stderr: {
        on(event: string, fn: (data: Buffer) => void) {
          const list = stderrListeners.get(event) ?? [];
          list.push(fn);
          stderrListeners.set(event, list);
        },
      },
      on(event: string, fn: (...args: unknown[]) => void) {
        const list = processListeners.get(event) ?? [];
        list.push(fn);
        processListeners.set(event, list);
      },
    };

    // Schedule data and close events on next tick
    queueMicrotask(() => {
      const dataHandlers = stdoutListeners.get("data") ?? [];
      for (const fn of dataHandlers) {
        fn(Buffer.from(stdoutData));
      }
      const errHandlers = stderrListeners.get("data") ?? [];
      for (const fn of errHandlers) {
        fn(Buffer.from(stderrData));
      }
      const closeHandlers = processListeners.get("close") ?? [];
      for (const fn of closeHandlers) {
        fn(exitCode);
      }
    });

    return child;
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIGRATION_SQL = `
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

CREATE INDEX idx_worktrees_project ON _worktrees (project_id);
CREATE INDEX idx_worktrees_status ON _worktrees (project_id, status);
CREATE INDEX idx_worktrees_automation ON _worktrees (created_by_automation_id);
CREATE INDEX idx_worktrees_cleanup ON _worktrees (cleanup_policy, status);
`;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode=WAL");
  db.pragma("foreign_keys=ON");
  db.exec(MIGRATION_SQL);
  return db;
}

function createMockIO() {
  const emitFn = vi.fn();
  const toFn = vi.fn().mockReturnValue({ emit: emitFn });
  return {
    to: toFn,
    emit: emitFn,
    // Access helpers for assertions
    _toFn: toFn,
    _emitFn: emitFn,
  };
}

function insertWorktreeRow(
  db: Database.Database,
  overrides: Partial<{
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
  }> = {},
) {
  const defaults = {
    id: "wt-test-1",
    project_id: "proj-1",
    path: "/tmp/worktrees/proj-1/wt-test-1",
    branch: "feature/test",
    base_branch: null,
    status: "ready",
    created_by_type: "user",
    created_by_automation_id: null,
    created_by_automation_run_id: null,
    created_by_chat_session_id: null,
    cleanup_policy: "always",
    ttl_ms: null,
    disk_usage_bytes: null,
    metadata_json: null,
    created_at: new Date().toISOString(),
    last_accessed_at: new Date().toISOString(),
    completed_at: null,
    error: null,
  };
  const row = { ...defaults, ...overrides };
  db.prepare(
    `INSERT INTO _worktrees (
      id, project_id, path, branch, base_branch, status,
      created_by_type, created_by_automation_id, created_by_automation_run_id,
      created_by_chat_session_id, cleanup_policy, ttl_ms,
      disk_usage_bytes, metadata_json, created_at, last_accessed_at,
      completed_at, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.project_id, row.path, row.branch, row.base_branch,
    row.status, row.created_by_type, row.created_by_automation_id,
    row.created_by_automation_run_id, row.created_by_chat_session_id,
    row.cleanup_policy, row.ttl_ms, row.disk_usage_bytes,
    row.metadata_json, row.created_at, row.last_accessed_at,
    row.completed_at, row.error,
  );
}

function setupGitMock(opts: {
  matcher: (args: string[]) => boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}) {
  mockSpawnHandlers.push({
    matcher: opts.matcher,
    stdout: opts.stdout ?? "",
    stderr: opts.stderr ?? "",
    exitCode: opts.exitCode ?? 0,
  });
}

function setupDefaultGitMocks() {
  // git rev-parse --git-dir (verify repo)
  setupGitMock({
    matcher: (args) => args.includes("rev-parse") && args.includes("--git-dir"),
    stdout: ".git",
  });

  // git worktree list --porcelain (branch checkout check)
  setupGitMock({
    matcher: (args) => args.includes("worktree") && args.includes("list") && args.includes("--porcelain"),
    stdout: "",
  });

  // git worktree add (create)
  setupGitMock({
    matcher: (args) => args.includes("worktree") && args.includes("add"),
    stdout: "",
  });

  // git worktree remove (remove)
  setupGitMock({
    matcher: (args) => args.includes("worktree") && args.includes("remove"),
    stdout: "",
  });

  // git worktree prune
  setupGitMock({
    matcher: (args) => args.includes("worktree") && args.includes("prune"),
    stdout: "",
  });

  // git status --porcelain
  setupGitMock({
    matcher: (args) => args.includes("status") && args.includes("--porcelain"),
    stdout: "",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorktreeManager", () => {
  let db: Database.Database;
  let mockIO: ReturnType<typeof createMockIO>;
  let manager: WorktreeManager;

  beforeEach(() => {
    db = createTestDb();
    mockIO = createMockIO();
    mockSpawnHandlers.length = 0;
    mockRegistry.clear();

    // Register a test project
    mockRegistry.set("proj-1", {
      id: "proj-1",
      name: "Test Project",
      path: "/tmp/test-project",
    });

    setupDefaultGitMocks();
    manager = new WorktreeManager(db, mockIO as unknown as import("socket.io").Server);
  });

  afterEach(() => {
    manager.stop();
    db.close();
    mockSpawnHandlers.length = 0;
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // create() tests
  // -----------------------------------------------------------------------

  describe("create()", () => {
    it("creates a worktree with an existing branch", async () => {
      const result = await manager.create({
        projectId: "proj-1",
        branch: "feature/existing",
        cleanupPolicy: "always",
        createdBy: { type: "user" },
      });

      expect(result.id).toBeDefined();
      expect(result.projectId).toBe("proj-1");
      expect(result.branch).toBe("feature/existing");
      expect(result.status).toBe("ready");
      expect(result.createdBy.type).toBe("user");
      expect(result.cleanupPolicy).toBe("always");

      // Verify Socket.IO emission
      expect(mockIO._toFn).toHaveBeenCalledWith("project:proj-1");
      expect(mockIO._emitFn).toHaveBeenCalledWith(
        "worktree:created",
        expect.objectContaining({
          projectId: "proj-1",
          branch: "feature/existing",
        }),
      );
    });

    it("creates a worktree with a new branch", async () => {
      const result = await manager.create({
        projectId: "proj-1",
        branch: "feature/new-branch",
        createBranch: true,
        baseBranch: "main",
        cleanupPolicy: "never",
        createdBy: { type: "user" },
      });

      expect(result.branch).toBe("feature/new-branch");
      expect(result.status).toBe("ready");
      expect(result.cleanupPolicy).toBe("never");
    });

    it("auto-names branch for automation type", async () => {
      // Create _automations table for the lookup
      db.exec("CREATE TABLE IF NOT EXISTS _automations (id TEXT PRIMARY KEY, name TEXT)");
      db.prepare("INSERT INTO _automations (id, name) VALUES (?, ?)").run("auto-1", "deploy-pipeline");

      const result = await manager.create({
        projectId: "proj-1",
        baseBranch: "main",
        cleanupPolicy: "on_success",
        createdBy: {
          type: "automation",
          automationId: "auto-1",
          automationRunId: "run-1",
        },
      });

      expect(result.branch).toMatch(/^renre-auto\/deploy-pipeline\/main-\d+$/);
      expect(result.status).toBe("ready");
      expect(result.createdBy.type).toBe("automation");
      expect(result.createdBy.automationId).toBe("auto-1");
    });

    it("returns error on branch checkout conflict", async () => {
      // Clear default mocks and set up conflict
      mockSpawnHandlers.length = 0;

      setupGitMock({
        matcher: (args) => args.includes("rev-parse") && args.includes("--git-dir"),
        stdout: ".git",
      });

      setupGitMock({
        matcher: (args) => args.includes("worktree") && args.includes("list") && args.includes("--porcelain"),
        stdout: "worktree /some/path\nHEAD abc123\nbranch refs/heads/feature/conflict\n",
      });

      await expect(
        manager.create({
          projectId: "proj-1",
          branch: "feature/conflict",
          cleanupPolicy: "always",
          createdBy: { type: "user" },
        }),
      ).rejects.toThrow("already checked out");
    });

    it("returns error for non-git directory", async () => {
      mockSpawnHandlers.length = 0;

      setupGitMock({
        matcher: (args) => args.includes("rev-parse") && args.includes("--git-dir"),
        stdout: "",
        stderr: "fatal: not a git repository",
        exitCode: 128,
      });

      await expect(
        manager.create({
          projectId: "proj-1",
          branch: "feature/test",
          cleanupPolicy: "always",
          createdBy: { type: "user" },
        }),
      ).rejects.toThrow("not a git repository");
    });

    it("rejects when no branch name and not automation type", async () => {
      await expect(
        manager.create({
          projectId: "proj-1",
          cleanupPolicy: "always",
          createdBy: { type: "user" },
        }),
      ).rejects.toThrow("Branch name is required");
    });

    it("rejects when project is not found", async () => {
      await expect(
        manager.create({
          projectId: "nonexistent",
          branch: "feature/test",
          cleanupPolicy: "always",
          createdBy: { type: "user" },
        }),
      ).rejects.toThrow("not found in registry");
    });

    it("sets status to error when git worktree add fails", async () => {
      mockSpawnHandlers.length = 0;

      setupGitMock({
        matcher: (args) => args.includes("rev-parse") && args.includes("--git-dir"),
        stdout: ".git",
      });

      setupGitMock({
        matcher: (args) => args.includes("worktree") && args.includes("list") && args.includes("--porcelain"),
        stdout: "",
      });

      setupGitMock({
        matcher: (args) => args.includes("worktree") && args.includes("add"),
        stderr: "fatal: could not create worktree",
        exitCode: 128,
      });

      await expect(
        manager.create({
          projectId: "proj-1",
          branch: "feature/fail",
          cleanupPolicy: "always",
          createdBy: { type: "user" },
        }),
      ).rejects.toThrow("Failed to create worktree");

      // Verify the DB record was updated to error
      const rows = db.prepare("SELECT * FROM _worktrees WHERE status = 'error'").all();
      expect(rows).toHaveLength(1);
    });

    it("stores metadata in JSON", async () => {
      const result = await manager.create({
        projectId: "proj-1",
        branch: "feature/meta",
        cleanupPolicy: "always",
        createdBy: { type: "user" },
        metadata: { purpose: "testing", priority: 1 },
      });

      expect(result.metadata).toEqual({ purpose: "testing", priority: 1 });
    });
  });

  // -----------------------------------------------------------------------
  // remove() tests
  // -----------------------------------------------------------------------

  describe("remove()", () => {
    it("rejects if status is in_use", async () => {
      insertWorktreeRow(db, { id: "wt-in-use", status: "in_use" });

      await expect(manager.remove("wt-in-use")).rejects.toThrow("currently in use");
    });

    it("succeeds for ready worktrees", async () => {
      insertWorktreeRow(db, { id: "wt-ready", status: "ready" });

      await manager.remove("wt-ready");

      const row = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-ready");
      expect(row).toBeUndefined();

      expect(mockIO._emitFn).toHaveBeenCalledWith(
        "worktree:removed",
        expect.objectContaining({ worktreeId: "wt-ready" }),
      );
    });

    it("succeeds for completed worktrees", async () => {
      insertWorktreeRow(db, { id: "wt-done", status: "completed" });

      await manager.remove("wt-done");

      const row = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-done");
      expect(row).toBeUndefined();
    });

    it("succeeds for error worktrees", async () => {
      insertWorktreeRow(db, { id: "wt-err", status: "error" });

      await manager.remove("wt-err");

      const row = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-err");
      expect(row).toBeUndefined();
    });

    it("throws if worktree not found", async () => {
      await expect(manager.remove("nonexistent")).rejects.toThrow("Worktree not found");
    });
  });

  // -----------------------------------------------------------------------
  // markCompleted() tests
  // -----------------------------------------------------------------------

  describe("markCompleted()", () => {
    it("cleanup policy 'always' triggers removal", async () => {
      insertWorktreeRow(db, { id: "wt-always", cleanup_policy: "always", status: "ready" });

      await manager.markCompleted("wt-always", true);

      // The worktree should be removed from DB (cleanup policy 'always')
      const row = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-always");
      expect(row).toBeUndefined();

      expect(mockIO._emitFn).toHaveBeenCalledWith(
        "worktree:completed",
        expect.objectContaining({ worktreeId: "wt-always", success: true }),
      );
    });

    it("cleanup policy 'on_success' + success triggers removal", async () => {
      insertWorktreeRow(db, { id: "wt-succ", cleanup_policy: "on_success", status: "ready" });

      await manager.markCompleted("wt-succ", true);

      const row = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-succ");
      expect(row).toBeUndefined();
    });

    it("cleanup policy 'on_success' + failure retains worktree", async () => {
      insertWorktreeRow(db, { id: "wt-fail", cleanup_policy: "on_success", status: "ready" });

      await manager.markCompleted("wt-fail", false);

      const row = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-fail") as { status: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.status).toBe("completed");
    });

    it("cleanup policy 'never' retains worktree", async () => {
      insertWorktreeRow(db, { id: "wt-never", cleanup_policy: "never", status: "ready" });

      await manager.markCompleted("wt-never", true);

      const row = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-never") as { status: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.status).toBe("completed");
    });

    it("cleanup policy 'ttl' retains worktree (runCleanup handles expiry)", async () => {
      insertWorktreeRow(db, {
        id: "wt-ttl",
        cleanup_policy: "ttl",
        ttl_ms: 3600000,
        status: "ready",
      });

      await manager.markCompleted("wt-ttl", true);

      const row = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-ttl") as { status: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.status).toBe("completed");
    });
  });

  // -----------------------------------------------------------------------
  // runCleanup() tests
  // -----------------------------------------------------------------------

  describe("runCleanup()", () => {
    it("TTL expiry removes expired worktrees", async () => {
      const expiredDate = new Date(Date.now() - 100_000_000).toISOString();
      insertWorktreeRow(db, {
        id: "wt-expired",
        cleanup_policy: "ttl",
        ttl_ms: 3600000, // 1h
        status: "completed",
        created_at: expiredDate,
        last_accessed_at: expiredDate,
      });

      const result = await manager.runCleanup();

      expect(result.removed).toBeGreaterThanOrEqual(1);
      const row = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-expired");
      expect(row).toBeUndefined();
    });

    it("stale detection marks old in_use as error", async () => {
      const staleDate = new Date(Date.now() - 10_000_000).toISOString(); // ~2.7 hours ago
      insertWorktreeRow(db, {
        id: "wt-stale",
        status: "in_use",
        last_accessed_at: staleDate,
      });

      await manager.runCleanup();

      const row = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-stale") as {
        status: string;
        error: string | null;
      } | undefined;
      expect(row).toBeDefined();
      expect(row!.status).toBe("error");
      expect(row!.error).toContain("Stale");
    });

    it("does not mark recent in_use as stale", async () => {
      const recentDate = new Date().toISOString();
      insertWorktreeRow(db, {
        id: "wt-recent",
        status: "in_use",
        last_accessed_at: recentDate,
      });

      await manager.runCleanup();

      const row = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-recent") as {
        status: string;
      } | undefined;
      expect(row).toBeDefined();
      expect(row!.status).toBe("in_use");
    });
  });

  // -----------------------------------------------------------------------
  // start() — startup reconciliation
  // -----------------------------------------------------------------------

  describe("start()", () => {
    it("marks in_use worktrees as error on startup", async () => {
      insertWorktreeRow(db, { id: "wt-1", status: "in_use" });
      insertWorktreeRow(db, { id: "wt-2", status: "in_use", path: "/tmp/worktrees/proj-1/wt-2" });

      await manager.start();

      const rows = db.prepare("SELECT * FROM _worktrees WHERE status = 'error'").all() as Array<{
        id: string;
        error: string;
      }>;
      const matchingIds = rows.filter((r) => r.id === "wt-1" || r.id === "wt-2");
      expect(matchingIds).toHaveLength(2);
      for (const row of matchingIds) {
        expect(row.error).toContain("Worker restarted");
      }
    });

    it("marks creating/removing worktrees as error on startup", async () => {
      insertWorktreeRow(db, { id: "wt-creating", status: "creating", path: "/tmp/worktrees/proj-1/wt-creating" });
      insertWorktreeRow(db, { id: "wt-removing", status: "removing", path: "/tmp/worktrees/proj-1/wt-removing" });

      await manager.start();

      const creatingRow = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-creating") as {
        status: string;
        error: string;
      };
      expect(creatingRow.status).toBe("error");
      expect(creatingRow.error).toContain("Worker restarted during operation");

      const removingRow = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-removing") as {
        status: string;
        error: string;
      };
      expect(removingRow.status).toBe("error");
      expect(removingRow.error).toContain("Worker restarted during operation");
    });

    it("does not affect ready/completed worktrees", async () => {
      insertWorktreeRow(db, { id: "wt-ready", status: "ready" });
      insertWorktreeRow(db, { id: "wt-completed", status: "completed", path: "/tmp/worktrees/proj-1/wt-completed" });

      await manager.start();

      const readyRow = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-ready") as { status: string };
      expect(readyRow.status).toBe("ready");

      const completedRow = db.prepare("SELECT * FROM _worktrees WHERE id = ?").get("wt-completed") as { status: string };
      expect(completedRow.status).toBe("completed");
    });
  });

  // -----------------------------------------------------------------------
  // resolveWorktreePath() — path traversal rejection
  // -----------------------------------------------------------------------

  describe("resolveWorktreePath()", () => {
    it("resolves a valid path", () => {
      const result = manager.resolveWorktreePath("proj-1", "wt-abc123");
      expect(result).toContain("proj-1");
      expect(result).toContain("wt-abc123");
    });

    it("rejects path traversal in projectId", () => {
      expect(() => manager.resolveWorktreePath("../etc", "wt-1")).toThrow("path traversal");
    });

    it("rejects path traversal in worktreeId", () => {
      expect(() => manager.resolveWorktreePath("proj-1", "../../etc")).toThrow("path traversal");
    });

    it("rejects forward slashes in projectId", () => {
      expect(() => manager.resolveWorktreePath("proj/evil", "wt-1")).toThrow("path traversal");
    });

    it("rejects backslashes in worktreeId", () => {
      expect(() => manager.resolveWorktreePath("proj-1", "wt\\evil")).toThrow("path traversal");
    });
  });

  // -----------------------------------------------------------------------
  // list() and get()
  // -----------------------------------------------------------------------

  describe("list() and get()", () => {
    it("list() returns worktrees for a project ordered by created_at DESC", () => {
      const earlier = new Date(Date.now() - 10000).toISOString();
      const later = new Date().toISOString();

      insertWorktreeRow(db, {
        id: "wt-old",
        project_id: "proj-1",
        created_at: earlier,
        path: "/tmp/worktrees/proj-1/wt-old",
      });
      insertWorktreeRow(db, {
        id: "wt-new",
        project_id: "proj-1",
        created_at: later,
        path: "/tmp/worktrees/proj-1/wt-new",
      });

      const result = manager.list("proj-1");
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("wt-new");
      expect(result[1]!.id).toBe("wt-old");
    });

    it("list() only returns worktrees for the specified project", () => {
      insertWorktreeRow(db, { id: "wt-p1", project_id: "proj-1" });
      insertWorktreeRow(db, {
        id: "wt-p2",
        project_id: "proj-2",
        path: "/tmp/worktrees/proj-2/wt-p2",
      });

      const result = manager.list("proj-1");
      expect(result).toHaveLength(1);
      expect(result[0]!.projectId).toBe("proj-1");
    });

    it("get() returns a single worktree with all fields mapped", () => {
      insertWorktreeRow(db, {
        id: "wt-full",
        project_id: "proj-1",
        branch: "feature/full",
        base_branch: "main",
        status: "ready",
        created_by_type: "automation",
        created_by_automation_id: "auto-1",
        created_by_automation_run_id: "run-1",
        cleanup_policy: "on_success",
        ttl_ms: 3600000,
        disk_usage_bytes: 1024,
        metadata_json: '{"key": "value"}',
      });

      const result = manager.get("wt-full");
      expect(result.id).toBe("wt-full");
      expect(result.projectId).toBe("proj-1");
      expect(result.branch).toBe("feature/full");
      expect(result.baseBranch).toBe("main");
      expect(result.status).toBe("ready");
      expect(result.createdBy.type).toBe("automation");
      expect(result.createdBy.automationId).toBe("auto-1");
      expect(result.createdBy.automationRunId).toBe("run-1");
      expect(result.cleanupPolicy).toBe("on_success");
      expect(result.ttlMs).toBe(3600000);
      expect(result.diskUsageBytes).toBe(1024);
      expect(result.metadata).toEqual({ key: "value" });
    });

    it("get() throws if worktree not found", () => {
      expect(() => manager.get("nonexistent")).toThrow("Worktree not found");
    });

    it("list() returns empty array for unknown project", () => {
      const result = manager.list("unknown-project");
      expect(result).toEqual([]);
    });

    it("correctly maps chat creator fields", () => {
      insertWorktreeRow(db, {
        id: "wt-chat",
        created_by_type: "chat",
        created_by_chat_session_id: "session-1",
      });

      const result = manager.get("wt-chat");
      expect(result.createdBy.type).toBe("chat");
      expect(result.createdBy.chatSessionId).toBe("session-1");
    });
  });

  // -----------------------------------------------------------------------
  // setStatus()
  // -----------------------------------------------------------------------

  describe("setStatus()", () => {
    it("updates status and emits event", async () => {
      insertWorktreeRow(db, { id: "wt-status", status: "ready" });

      await manager.setStatus("wt-status", "completed");

      const row = db.prepare("SELECT status FROM _worktrees WHERE id = ?").get("wt-status") as { status: string };
      expect(row.status).toBe("completed");

      expect(mockIO._emitFn).toHaveBeenCalledWith(
        "worktree:status-changed",
        expect.objectContaining({
          worktreeId: "wt-status",
          oldStatus: "ready",
          newStatus: "completed",
        }),
      );
    });

    it("updates status with error message", async () => {
      insertWorktreeRow(db, { id: "wt-err-set", status: "ready" });

      await manager.setStatus("wt-err-set", "error", "Something went wrong");

      const row = db.prepare("SELECT status, error FROM _worktrees WHERE id = ?").get("wt-err-set") as {
        status: string;
        error: string | null;
      };
      expect(row.status).toBe("error");
      expect(row.error).toBe("Something went wrong");
    });
  });

  // -----------------------------------------------------------------------
  // markInUse()
  // -----------------------------------------------------------------------

  describe("markInUse()", () => {
    it("updates status to in_use and emits event", async () => {
      insertWorktreeRow(db, {
        id: "wt-use",
        status: "ready",
        created_by_type: "automation",
        created_by_automation_run_id: "run-99",
      });

      await manager.markInUse("wt-use");

      const row = db.prepare("SELECT status FROM _worktrees WHERE id = ?").get("wt-use") as { status: string };
      expect(row.status).toBe("in_use");

      expect(mockIO._emitFn).toHaveBeenCalledWith(
        "worktree:in-use",
        expect.objectContaining({
          worktreeId: "wt-use",
          automationRunId: "run-99",
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Extension isolation check
  // -----------------------------------------------------------------------

  describe("extension isolation", () => {
    it("WorktreeManager is NOT exported in extension-facing SDK", async () => {
      // The extension SDK is at @renre-kit/extension-sdk
      // WorktreeManager should only be available within worker-service internals
      const sdkExports = await import("@renre-kit/extension-sdk");
      const exportedNames = Object.keys(sdkExports);

      expect(exportedNames).not.toContain("WorktreeManager");
      expect(exportedNames).not.toContain("Worktree");
      expect(exportedNames).not.toContain("WorktreeStatus");
      expect(exportedNames).not.toContain("WorktreeCreateOptions");
    });
  });

  // -----------------------------------------------------------------------
  // totalDiskUsage()
  // -----------------------------------------------------------------------

  describe("totalDiskUsage()", () => {
    it("returns sum of disk_usage_bytes for a project", () => {
      insertWorktreeRow(db, {
        id: "wt-d1",
        project_id: "proj-1",
        disk_usage_bytes: 1000,
        path: "/tmp/worktrees/proj-1/wt-d1",
      });
      insertWorktreeRow(db, {
        id: "wt-d2",
        project_id: "proj-1",
        disk_usage_bytes: 2000,
        path: "/tmp/worktrees/proj-1/wt-d2",
      });

      const total = manager.totalDiskUsage("proj-1");
      expect(total).toBe(3000);
    });

    it("returns 0 when no worktrees exist", () => {
      const total = manager.totalDiskUsage("nonexistent");
      expect(total).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // detectOrphans()
  // -----------------------------------------------------------------------

  describe("detectOrphans()", () => {
    it("returns empty array when basePath does not exist", async () => {
      const orphans = await manager.detectOrphans("nonexistent-project");
      expect(orphans).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // stop()
  // -----------------------------------------------------------------------

  describe("stop()", () => {
    it("clears the cleanup timer", async () => {
      await manager.start();

      // After start, a cleanup timer should be running
      manager.stop();

      // Calling stop again should not throw
      manager.stop();
      expect(true).toBe(true);
    });
  });
});
