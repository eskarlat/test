import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

let testDir: string;
let dataDbPath: string;
let backupsPath: string;

vi.mock("./paths.js", () => ({
  globalPaths: () => ({
    dataDb: dataDbPath,
    backupsDir: backupsPath,
    globalDir: testDir,
  }),
}));

import {
  createPreMigrationBackup,
  createPeriodicBackup,
  shouldRunPeriodicBackup,
  pruneBackups,
  checkDatabaseIntegrity,
  findLatestBackup,
} from "./backup-manager.js";

describe("backup-manager", () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `bm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dataDbPath = join(testDir, "data.db");
    backupsPath = join(testDir, "backups");
    mkdirSync(testDir, { recursive: true });

    // Create a real SQLite database
    const db = new Database(dataDbPath);
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)");
    db.exec("INSERT INTO test (val) VALUES ('hello')");
    db.close();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("createPreMigrationBackup", () => {
    it("creates a backup file", () => {
      const backupPath = createPreMigrationBackup("upgrade");
      expect(existsSync(backupPath)).toBe(true);
      expect(backupPath).toContain("pre-upgrade");

      // Verify backup is valid
      const bdb = new Database(backupPath, { readonly: true });
      const rows = bdb.prepare("SELECT val FROM test").all() as Array<{ val: string }>;
      bdb.close();
      expect(rows[0]!.val).toBe("hello");
    });

    it("creates backups dir if missing", () => {
      expect(existsSync(backupsPath)).toBe(false);
      createPreMigrationBackup("init");
      expect(existsSync(backupsPath)).toBe(true);
    });
  });

  describe("createPeriodicBackup", () => {
    it("creates a periodic backup", () => {
      const backupPath = createPeriodicBackup();
      expect(backupPath).not.toBeNull();
      expect(backupPath!).toContain("periodic");
      expect(existsSync(backupPath!)).toBe(true);
    });

    it("returns null if database does not exist", () => {
      rmSync(dataDbPath);
      const result = createPeriodicBackup();
      expect(result).toBeNull();
    });
  });

  describe("shouldRunPeriodicBackup", () => {
    it("returns true when no backups exist", () => {
      expect(shouldRunPeriodicBackup(24)).toBe(true);
    });

    it("returns false when recent backup exists", () => {
      createPeriodicBackup();
      expect(shouldRunPeriodicBackup(24)).toBe(false);
    });
  });

  describe("pruneBackups", () => {
    it("prunes old periodic backups by age", () => {
      // Create several backups with old timestamps
      mkdirSync(backupsPath, { recursive: true });
      const oldFile = join(backupsPath, "data-old-periodic.db");
      writeFileSync(oldFile, "fake");
      // Set mtime to 100 days ago
      const fs = require("node:fs");
      const oldTime = new Date(Date.now() - 100 * 24 * 3600 * 1000);
      fs.utimesSync(oldFile, oldTime, oldTime);

      pruneBackups({ maxCount: 100, maxAgeDays: 30 });
      expect(existsSync(oldFile)).toBe(false);
    });

    it("prunes excess periodic backups by count", () => {
      mkdirSync(backupsPath, { recursive: true });
      // Create more than maxCount backups
      for (let i = 0; i < 5; i++) {
        const f = join(backupsPath, `data-${i}-periodic.db`);
        writeFileSync(f, `backup-${i}`);
        const time = new Date(Date.now() - (5 - i) * 1000);
        const fs = require("node:fs");
        fs.utimesSync(f, time, time);
      }

      pruneBackups({ maxCount: 2, maxAgeDays: 365 });
      const remaining = readdirSync(backupsPath).filter((f) => f.includes("-periodic.db"));
      expect(remaining.length).toBe(2);
    });

    it("handles missing backups dir", () => {
      pruneBackups({ maxCount: 10, maxAgeDays: 30 });
      // Should not throw
    });
  });

  describe("checkDatabaseIntegrity", () => {
    it("returns true for valid database", () => {
      expect(checkDatabaseIntegrity()).toBe(true);
    });

    it("returns true when no database exists", () => {
      rmSync(dataDbPath);
      expect(checkDatabaseIntegrity()).toBe(true);
    });
  });

  describe("findLatestBackup", () => {
    it("returns null when no backups exist", () => {
      expect(findLatestBackup()).toBeNull();
    });

    it("returns path to most recent backup", () => {
      createPreMigrationBackup("test1");
      const second = createPreMigrationBackup("test2");
      const latest = findLatestBackup();
      expect(latest).toBe(second);
    });
  });
});
