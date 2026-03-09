import {
  copyFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { globalPaths } from "./paths.js";
import { logger } from "./logger.js";

export interface BackupRetentionConfig {
  maxCount: number;
  maxAgeDays: number;
}

export function createPreMigrationBackup(operation: string): string {
  const { dataDb, backupsDir } = globalPaths();
  mkdirSync(backupsDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupsDir, `data-${ts}-pre-${operation}.db`);

  // Flush WAL before copy
  const db = new Database(dataDb);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();

  // Atomic copy
  copyFileSync(dataDb, backupPath);

  // Verify integrity on backup
  const backupDb = new Database(backupPath, { readonly: true });
  const result = backupDb.pragma("integrity_check") as Array<{ integrity_check: string }>;
  backupDb.close();

  if (result[0]?.integrity_check !== "ok") {
    unlinkSync(backupPath);
    throw new Error(`Backup integrity check failed for ${operation}: ${result[0]?.integrity_check}`);
  }

  logger.info("backup", `Pre-migration backup created: ${backupPath}`);
  return backupPath;
}

export function createPeriodicBackup(): string | null {
  const { dataDb, backupsDir } = globalPaths();
  if (!existsSync(dataDb)) return null;

  mkdirSync(backupsDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupsDir, `data-${ts}-periodic.db`);

  const db = new Database(dataDb);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();

  copyFileSync(dataDb, backupPath);
  logger.info("backup", `Periodic backup created: ${backupPath}`);
  return backupPath;
}

export function shouldRunPeriodicBackup(intervalHours: number): boolean {
  const { backupsDir } = globalPaths();
  if (!existsSync(backupsDir)) return true;

  const backups = getBackupFiles().filter((f) => f.includes("-periodic.db"));
  if (backups.length === 0) return true;

  const latest = backups[backups.length - 1];
  if (!latest) return true;
  const stat = statSync(join(backupsDir, latest));
  const ageMs = Date.now() - stat.mtimeMs;
  return ageMs > intervalHours * 3600 * 1000;
}

export function pruneBackups(config: BackupRetentionConfig): void {
  const { backupsDir } = globalPaths();
  if (!existsSync(backupsDir)) return;

  const now = Date.now();
  pruneByAge(backupsDir, now, config.maxAgeDays);
  pruneByCount(backupsDir, config.maxCount);
}

function pruneByAge(backupsDir: string, now: number, maxAgeDays: number): void {
  const maxAgeMs = maxAgeDays * 24 * 3600 * 1000;
  const preMigrationProtectMs = 7 * 24 * 3600 * 1000;

  const backups = getBackupFiles()
    .map((f) => ({ name: f, path: join(backupsDir, f), stat: statSync(join(backupsDir, f)) }))
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);

  for (const b of backups) {
    const age = now - b.stat.mtimeMs;
    if (b.name.includes("-periodic.db") && age > maxAgeMs) {
      unlinkSync(b.path);
      logger.info("backup", `Pruned old backup: ${b.name}`);
    } else if (b.name.includes("-pre-") && age > preMigrationProtectMs) {
      unlinkSync(b.path);
      logger.info("backup", `Pruned old pre-migration backup: ${b.name}`);
    }
  }
}

function pruneByCount(backupsDir: string, maxCount: number): void {
  const remaining = getBackupFiles()
    .filter((f) => f.includes("-periodic.db"))
    .map((f) => ({ name: f, path: join(backupsDir, f), stat: statSync(join(backupsDir, f)) }))
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);

  while (remaining.length > maxCount) {
    const oldest = remaining.shift();
    if (oldest) {
      unlinkSync(oldest.path);
      logger.info("backup", `Pruned excess backup: ${oldest.name}`);
    }
  }
}

export function checkDatabaseIntegrity(): boolean {
  const { dataDb } = globalPaths();
  if (!existsSync(dataDb)) return true;
  try {
    const db = new Database(dataDb, { readonly: true });
    const result = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
    db.close();
    return result[0]?.integrity_check === "ok";
  } catch {
    return false;
  }
}

export function findLatestBackup(): string | null {
  const { backupsDir } = globalPaths();
  if (!existsSync(backupsDir)) return null;

  const backups = getBackupFiles()
    .map((f) => ({ name: f, path: join(backupsDir, f), stat: statSync(join(backupsDir, f)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  return backups[0]?.path ?? null;
}

function getBackupFiles(): string[] {
  const { backupsDir } = globalPaths();
  if (!existsSync(backupsDir)) return [];
  return readdirSync(backupsDir).filter((f) => f.endsWith(".db"));
}
