import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { globalPaths } from "./paths.js";
import { logger } from "./logger.js";
import { MigrationRunner } from "./migration-runner.js";
import { createScopedDatabase, type ScopedDatabase } from "./scoped-database.js";
import { checkDatabaseIntegrity } from "./backup-manager.js";
import { setFilePermissions } from "../shared/platform.js";

export class DBManager {
  private db: Database.Database | null = null;
  private migrationRunner: MigrationRunner | null = null;

  getConnection(): Database.Database {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.db;
  }

  initialize(): void {
    const { dataDb } = globalPaths();
    mkdirSync(dirname(dataDb), { recursive: true });

    // Integrity check if DB exists
    if (existsSync(dataDb)) {
      if (!checkDatabaseIntegrity()) {
        logger.error("worker", "Database corruption detected!", {
          dataDb,
          action: "Check ~/.renre-kit/backups/ for recovery options",
        });
        throw new Error(
          "Database corruption detected. Check ~/.renre-kit/backups/ for recovery options.",
        );
      }
    }

    this.db = new Database(dataDb);
    this.db.pragma("journal_mode=WAL");
    this.db.pragma("foreign_keys=ON");
    setFilePermissions(dataDb, 0o600);

    this.migrationRunner = new MigrationRunner(this.db);

    logger.info("worker", "Database initialized (WAL mode)");
  }

  runCoreMigrations(): void {
    if (!this.migrationRunner) throw new Error("DB not initialized");
    this.migrationRunner.runCoreMigrations();
  }

  runExtensionMigrations(
    extensionName: string,
    projectId: string,
    migrationsDir: string,
  ): void {
    if (!this.migrationRunner) throw new Error("DB not initialized");
    this.migrationRunner.runExtensionMigrations(extensionName, projectId, migrationsDir);
  }

  rollbackExtensionMigrations(
    extensionName: string,
    projectId: string,
    migrationsDir: string,
  ): void {
    if (!this.migrationRunner) throw new Error("DB not initialized");
    this.migrationRunner.rollbackExtensionMigrations(extensionName, projectId, migrationsDir);
  }

  createScopedProxy(extensionName: string, projectId: string): ScopedDatabase {
    return createScopedDatabase(this.getConnection(), extensionName, projectId);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.migrationRunner = null;
      logger.info("worker", "Database connection closed");
    }
  }
}

export const dbManager = new DBManager();
