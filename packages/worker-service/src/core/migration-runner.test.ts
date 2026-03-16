import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

// Mock logger
vi.mock("./logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock paths
vi.mock("./paths.js", () => ({
  globalPaths: () => ({
    coreMigrationsDir: "/tmp/test-migrations/core",
  }),
}));

// Mock backup-manager
vi.mock("./backup-manager.js", () => ({
  createPreMigrationBackup: vi.fn().mockReturnValue("/tmp/backup.db"),
}));

// Mock fs
const mockExistsSync = vi.fn().mockReturnValue(true);
const mockReaddirSync = vi.fn().mockReturnValue([]);
const mockReadFileSync = vi.fn().mockReturnValue("");

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

import { MigrationRunner } from "./migration-runner.js";
import { createPreMigrationBackup } from "./backup-manager.js";

describe("MigrationRunner", () => {
  let db: InstanceType<typeof Database>;
  let runner: MigrationRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    runner = new MigrationRunner(db);
  });

  describe("constructor", () => {
    it("creates _migrations table", () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
        .all();
      expect(tables).toHaveLength(1);
    });
  });

  describe("runCoreMigrations", () => {
    it("does nothing when migrations dir does not exist", () => {
      mockExistsSync.mockReturnValue(false);
      runner.runCoreMigrations();
      expect(createPreMigrationBackup).not.toHaveBeenCalled();
    });

    it("does nothing when no pending migrations", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);
      runner.runCoreMigrations();
      expect(createPreMigrationBackup).not.toHaveBeenCalled();
    });

    it("applies pending core migrations", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        "001_create_sessions.up.sql",
        "001_create_sessions.down.sql",
      ]);
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (String(filePath).includes(".up.sql")) {
          return "CREATE TABLE _test_sessions (id TEXT PRIMARY KEY);";
        }
        return "DROP TABLE IF EXISTS _test_sessions;";
      });

      runner.runCoreMigrations();

      expect(createPreMigrationBackup).toHaveBeenCalledWith("core-upgrade");
      // Verify table was created
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_test_sessions'")
        .all();
      expect(tables).toHaveLength(1);

      // Verify migration was recorded
      const migrations = db
        .prepare("SELECT * FROM _migrations WHERE extension_name = '__core__'")
        .all() as Array<{ version: string }>;
      expect(migrations).toHaveLength(1);
      expect(migrations[0]!.version).toBe("001");
    });

    it("skips already applied migrations", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        "001_init.up.sql",
        "001_init.down.sql",
      ]);
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (String(filePath).includes(".up.sql")) {
          return "CREATE TABLE IF NOT EXISTS _init_table (id TEXT);";
        }
        return "DROP TABLE IF EXISTS _init_table;";
      });

      // Run once
      runner.runCoreMigrations();
      vi.mocked(createPreMigrationBackup).mockClear();

      // Run again - should skip
      runner.runCoreMigrations();
      expect(createPreMigrationBackup).not.toHaveBeenCalled();
    });

    it("rolls back on migration failure and throws", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        "001_good.up.sql",
        "001_good.down.sql",
        "002_bad.up.sql",
        "002_bad.down.sql",
      ]);
      mockReadFileSync.mockImplementation((filePath: string) => {
        const path = String(filePath);
        if (path.includes("001_good.up.sql")) return "CREATE TABLE _good_table (id TEXT);";
        if (path.includes("001_good.down.sql")) return "DROP TABLE IF EXISTS _good_table;";
        if (path.includes("002_bad.up.sql")) return "INVALID SQL SYNTAX !!!";
        if (path.includes("002_bad.down.sql")) return "SELECT 1;";
        return "";
      });

      expect(() => runner.runCoreMigrations()).toThrow("Core migration failed at version 002");

      // The first migration should have been rolled back
      const migrations = db
        .prepare("SELECT * FROM _migrations WHERE extension_name = '__core__'")
        .all();
      expect(migrations).toHaveLength(0);
    });
  });

  describe("runExtensionMigrations", () => {
    it("applies extension migrations", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        "001_create_ext_table.up.sql",
        "001_create_ext_table.down.sql",
      ]);
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (String(filePath).includes(".up.sql")) {
          return "CREATE TABLE ext_test_items (id TEXT PRIMARY KEY, name TEXT);";
        }
        return "DROP TABLE IF EXISTS ext_test_items;";
      });

      runner.runExtensionMigrations("my-ext", "proj-1", "/tmp/ext/migrations");

      const migrations = db
        .prepare("SELECT * FROM _migrations WHERE extension_name = 'my-ext' AND project_id = 'proj-1'")
        .all() as Array<{ version: string }>;
      expect(migrations).toHaveLength(1);
      expect(migrations[0]!.version).toBe("001");
    });

    it("does nothing when no pending migrations", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);
      runner.runExtensionMigrations("my-ext", "proj-1", "/tmp/ext/migrations");
      expect(createPreMigrationBackup).not.toHaveBeenCalled();
    });
  });

  describe("rollbackExtensionMigrations", () => {
    it("rolls back applied migrations in reverse order", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        "001_first.up.sql",
        "001_first.down.sql",
        "002_second.up.sql",
        "002_second.down.sql",
      ]);

      // Setup readFileSync to return appropriate SQL
      mockReadFileSync.mockImplementation((filePath: string) => {
        const path = String(filePath);
        if (path.includes("001_first.up.sql")) return "CREATE TABLE ext_first (id TEXT);";
        if (path.includes("001_first.down.sql")) return "DROP TABLE IF EXISTS ext_first;";
        if (path.includes("002_second.up.sql")) return "CREATE TABLE ext_second (id TEXT);";
        if (path.includes("002_second.down.sql")) return "DROP TABLE IF EXISTS ext_second;";
        return "";
      });

      // Apply migrations first
      runner.runExtensionMigrations("my-ext", "proj-1", "/tmp/ext/migrations");

      // Verify tables exist
      const tablesBefore = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ext_%'")
        .all();
      expect(tablesBefore).toHaveLength(2);

      // Rollback
      runner.rollbackExtensionMigrations("my-ext", "proj-1", "/tmp/ext/migrations");

      // Verify tables were dropped
      const tablesAfter = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ext_%'")
        .all();
      expect(tablesAfter).toHaveLength(0);

      // Verify migration records were removed
      const migrations = db
        .prepare("SELECT * FROM _migrations WHERE extension_name = 'my-ext'")
        .all();
      expect(migrations).toHaveLength(0);
    });
  });

  describe("parseMigrationFile", () => {
    it("throws for invalid migration filename", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(["bad_name.up.sql"]);
      mockReadFileSync.mockReturnValue("SELECT 1;");

      expect(() =>
        runner.runExtensionMigrations("ext", "proj", "/tmp"),
      ).toThrow("Invalid migration filename");
    });

    it("throws when down migration is missing", () => {
      mockExistsSync.mockImplementation((p: string) => {
        // dir exists, but down file does not
        return !String(p).includes(".down.sql");
      });
      mockReaddirSync.mockReturnValue(["001_init.up.sql"]);
      mockReadFileSync.mockReturnValue("SELECT 1;");

      expect(() =>
        runner.runExtensionMigrations("ext", "proj", "/tmp"),
      ).toThrow("Missing down migration");
    });
  });
});
