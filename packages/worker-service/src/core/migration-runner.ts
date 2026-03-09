import {
  readdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { globalPaths } from "./paths.js";
import { logger } from "./logger.js";
import { createPreMigrationBackup } from "./backup-manager.js";

interface MigrationFile {
  version: string;
  description: string;
  upSql: string;
  downSql: string;
}

interface AppliedMigration {
  version: string;
  description: string;
}

export class MigrationRunner {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureMigrationsTable();
  }

  private ensureMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        extension_name TEXT NOT NULL,
        version TEXT NOT NULL,
        description TEXT NOT NULL,
        project_id TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        UNIQUE(extension_name, version, project_id)
      )
    `);
  }

  private getApplied(extensionName: string, projectId: string): AppliedMigration[] {
    const stmt = this.db.prepare(
      "SELECT version, description FROM _migrations WHERE extension_name = ? AND project_id = ? ORDER BY version ASC",
    );
    return stmt.all(extensionName, projectId) as AppliedMigration[];
  }

  private recordMigration(extensionName: string, projectId: string, version: string, description: string): void {
    this.db.prepare(
      "INSERT INTO _migrations (extension_name, version, description, project_id, applied_at) VALUES (?, ?, ?, ?, ?)",
    ).run(extensionName, version, description, projectId, new Date().toISOString());
  }

  private removeMigration(extensionName: string, projectId: string, version: string): void {
    this.db.prepare(
      "DELETE FROM _migrations WHERE extension_name = ? AND project_id = ? AND version = ?",
    ).run(extensionName, projectId, version);
  }

  private loadMigrations(migrationsDir: string): MigrationFile[] {
    if (!existsSync(migrationsDir)) return [];

    const files = readdirSync(migrationsDir).sort();
    const upFiles = files.filter((f) => f.endsWith(".up.sql"));

    return upFiles.map((upFile) => this.parseMigrationFile(migrationsDir, upFile));
  }

  private parseMigrationFile(migrationsDir: string, upFile: string): MigrationFile {
    const match = /^(\d{3})_(.+)\.up\.sql$/.exec(upFile);
    if (!match) throw new Error(`Invalid migration filename: ${upFile}`);
    const [, version, desc] = match;
    if (!version || !desc) throw new Error(`Invalid migration filename: ${upFile}`);

    const downFile = `${version}_${desc}.down.sql`;
    if (!existsSync(join(migrationsDir, downFile))) {
      throw new Error(`Missing down migration: ${downFile}`);
    }

    return {
      version,
      description: desc.replace(/_/g, " "),
      upSql: readFileSync(join(migrationsDir, upFile), "utf8"),
      downSql: readFileSync(join(migrationsDir, downFile), "utf8"),
    };
  }

  private applyMigration(migration: MigrationFile, extensionName: string, projectId: string): void {
    this.db.transaction(() => {
      this.db.exec(migration.upSql);
      this.recordMigration(extensionName, projectId, migration.version, migration.description);
    })();
  }

  private rollbackMigration(migration: MigrationFile, extensionName: string, projectId: string): void {
    this.db.transaction(() => {
      this.db.exec(migration.downSql);
      this.removeMigration(extensionName, projectId, migration.version);
    })();
  }

  private rollbackSucceeded(succeeded: MigrationFile[], extensionName: string, projectId: string, backupPath: string): void {
    for (const m of [...succeeded].reverse()) {
      try {
        this.rollbackMigration(m, extensionName, projectId);
      } catch (rollbackErr) {
        const rbMsg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
        logger.error("worker", `Rollback of migration ${m.version} also failed: ${rbMsg}`, { backupPath });
      }
    }
  }

  private getPendingMigrations(migrationsDir: string, extensionName: string, projectId: string): MigrationFile[] {
    const migrations = this.loadMigrations(migrationsDir);
    const applied = this.getApplied(extensionName, projectId);
    const appliedVersions = new Set(applied.map((m) => m.version));
    return migrations.filter((m) => !appliedVersions.has(m.version));
  }

  runCoreMigrations(): void {
    const { coreMigrationsDir } = globalPaths();
    if (!existsSync(coreMigrationsDir)) return;

    const pending = this.getPendingMigrations(coreMigrationsDir, "__core__", "__global__");
    if (pending.length === 0) return;

    const backupPath = this.requireBackup("core-upgrade");
    logger.info("worker", `Running ${pending.length} core migration(s)...`);

    const succeeded: MigrationFile[] = [];
    for (const migration of pending) {
      try {
        this.applyMigration(migration, "__core__", "__global__");
        succeeded.push(migration);
        logger.info("worker", `Core migration ${migration.version} applied: ${migration.description}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("worker", `Core migration ${migration.version} failed: ${msg}`, { backupPath });
        this.rollbackSucceeded(succeeded, "__core__", "__global__", backupPath);
        throw new Error(`Core migration failed at version ${migration.version}: ${msg}. Backup at: ${backupPath}`);
      }
    }
  }

  runExtensionMigrations(
    extensionName: string,
    projectId: string,
    migrationsDir: string,
  ): void {
    const pending = this.getPendingMigrations(migrationsDir, extensionName, projectId);
    if (pending.length === 0) return;

    const backupPath = this.requireBackup(`${extensionName}-upgrade`);
    const succeeded: MigrationFile[] = [];

    for (const migration of pending) {
      try {
        this.applyMigration(migration, extensionName, projectId);
        succeeded.push(migration);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.rollbackSucceeded(succeeded, extensionName, projectId, backupPath);
        throw new Error(`Migration ${migration.version} failed for ${extensionName}: ${msg}. Backup at: ${backupPath}`);
      }
    }
  }

  private requireBackup(operation: string): string {
    try {
      return createPreMigrationBackup(operation);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("worker", `Migration backup failed for ${operation}: ${msg}`);
      throw new Error(`Cannot run migrations for ${operation}: backup failed. ${msg}`);
    }
  }

  rollbackExtensionMigrations(
    extensionName: string,
    projectId: string,
    migrationsDir: string,
  ): void {
    const migrations = this.loadMigrations(migrationsDir);
    const applied = this.getApplied(extensionName, projectId);

    // Run down migrations in reverse order
    const toRollback = migrations
      .filter((m) => applied.some((a) => a.version === m.version))
      .reverse();

    for (const migration of toRollback) {
      this.rollbackMigration(migration, extensionName, projectId);
    }
  }
}
