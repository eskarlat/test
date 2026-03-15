import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  globalPaths: vi.fn().mockReturnValue({
    dataDb: ":memory:",
    globalDir: "/mock/global",
  }),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
  checkDatabaseIntegrity: vi.fn().mockReturnValue(true),
  setFilePermissions: vi.fn(),
  MigrationRunner: vi.fn().mockImplementation(() => ({
    runCoreMigrations: vi.fn(),
    runExtensionMigrations: vi.fn(),
    rollbackExtensionMigrations: vi.fn(),
  })),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
}));

vi.mock("./paths.js", () => ({
  globalPaths: mocks.globalPaths,
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: mocks.logInfo,
    warn: mocks.logWarn,
    error: mocks.logError,
    debug: mocks.logDebug,
  },
}));

vi.mock("./backup-manager.js", () => ({
  checkDatabaseIntegrity: mocks.checkDatabaseIntegrity,
}));

vi.mock("../shared/platform.js", () => ({
  setFilePermissions: mocks.setFilePermissions,
}));

vi.mock("./migration-runner.js", () => ({
  MigrationRunner: mocks.MigrationRunner,
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { DBManager } from "./db-manager.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DBManager", () => {
  let manager: DBManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new DBManager();
  });

  afterEach(() => {
    try {
      manager.close();
    } catch {
      // already closed or never initialized
    }
  });

  describe("getConnection", () => {
    it("throws when not initialized", () => {
      expect(() => manager.getConnection()).toThrow("Database not initialized");
    });

    it("returns connection after initialization", () => {
      manager.initialize();
      const conn = manager.getConnection();
      expect(conn).toBeDefined();
      expect(conn).toBeInstanceOf(Database);
    });
  });

  describe("initialize", () => {
    it("creates database with foreign keys enabled", () => {
      manager.initialize();
      const db = manager.getConnection();

      // In-memory databases return "memory" for journal_mode even when WAL is set,
      // so we just verify the pragma call doesn't throw and FK is on.
      const fk = db.pragma("foreign_keys", { simple: true });
      expect(fk).toBe(1);
    });

    it("creates directory for database", () => {
      manager.initialize();
      expect(mocks.mkdirSync).toHaveBeenCalled();
    });

    it("sets file permissions", () => {
      manager.initialize();
      expect(mocks.setFilePermissions).toHaveBeenCalledWith(":memory:", 0o600);
    });

    it("creates MigrationRunner", () => {
      manager.initialize();
      expect(mocks.MigrationRunner).toHaveBeenCalled();
    });

    it("logs database initialization", () => {
      manager.initialize();
      expect(mocks.logInfo).toHaveBeenCalledWith(
        "worker",
        "Database initialized (WAL mode)",
      );
    });

    it("checks integrity when database file exists", () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.checkDatabaseIntegrity.mockReturnValue(true);

      manager.initialize();

      expect(mocks.checkDatabaseIntegrity).toHaveBeenCalled();
    });

    it("throws on corruption when database file exists and integrity check fails", () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.checkDatabaseIntegrity.mockReturnValue(false);

      expect(() => manager.initialize()).toThrow("Database corruption detected");
      expect(mocks.logError).toHaveBeenCalled();
    });

    it("skips integrity check when database file does not exist", () => {
      mocks.existsSync.mockReturnValue(false);
      manager.initialize();
      expect(mocks.checkDatabaseIntegrity).not.toHaveBeenCalled();
    });
  });

  describe("runCoreMigrations", () => {
    it("throws when not initialized", () => {
      expect(() => manager.runCoreMigrations()).toThrow("DB not initialized");
    });

    it("delegates to MigrationRunner", () => {
      manager.initialize();
      manager.runCoreMigrations();

      const runner = mocks.MigrationRunner.mock.results[0].value;
      expect(runner.runCoreMigrations).toHaveBeenCalled();
    });
  });

  describe("runExtensionMigrations", () => {
    it("throws when not initialized", () => {
      expect(() =>
        manager.runExtensionMigrations("ext", "proj", "/dir"),
      ).toThrow("DB not initialized");
    });

    it("delegates to MigrationRunner with correct args", () => {
      manager.initialize();
      manager.runExtensionMigrations("my-ext", "proj-1", "/migrations/dir");

      const runner = mocks.MigrationRunner.mock.results[0].value;
      expect(runner.runExtensionMigrations).toHaveBeenCalledWith(
        "my-ext",
        "proj-1",
        "/migrations/dir",
      );
    });
  });

  describe("rollbackExtensionMigrations", () => {
    it("throws when not initialized", () => {
      expect(() =>
        manager.rollbackExtensionMigrations("ext", "proj", "/dir"),
      ).toThrow("DB not initialized");
    });

    it("delegates to MigrationRunner with correct args", () => {
      manager.initialize();
      manager.rollbackExtensionMigrations("my-ext", "proj-1", "/migrations/dir");

      const runner = mocks.MigrationRunner.mock.results[0].value;
      expect(runner.rollbackExtensionMigrations).toHaveBeenCalledWith(
        "my-ext",
        "proj-1",
        "/migrations/dir",
      );
    });
  });

  describe("createScopedProxy", () => {
    it("throws when not initialized", () => {
      expect(() => manager.createScopedProxy("ext", "proj")).toThrow(
        "Database not initialized",
      );
    });
  });

  describe("close", () => {
    it("closes the database connection", () => {
      manager.initialize();
      manager.close();
      expect(() => manager.getConnection()).toThrow("Database not initialized");
      expect(mocks.logInfo).toHaveBeenCalledWith(
        "worker",
        "Database connection closed",
      );
    });

    it("is safe to call when not initialized", () => {
      expect(() => manager.close()).not.toThrow();
    });

    it("is safe to call twice", () => {
      manager.initialize();
      manager.close();
      expect(() => manager.close()).not.toThrow();
    });
  });
});
