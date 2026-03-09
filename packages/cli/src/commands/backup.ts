import { Command } from "commander";
import { existsSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import * as clack from "@clack/prompts";
import pc from "picocolors";
import { globalPaths } from "../utils/paths.js";
import { formatTable } from "../utils/formatter.js";
import * as log from "../utils/logger.js";
import { readServerState, checkHealth } from "../services/server-client.js";

function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function humanAge(mtime: Date): string {
  const diffMs = Date.now() - mtime.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMins > 0) return `${diffMins}m ago`;
  return `${diffSecs}s ago`;
}

async function runCreateBackup(): Promise<void> {
  const state = readServerState();
  if (!state) {
    log.error("Worker service must be running to create a backup. Run `renre-kit start`");
    process.exit(1);
  }

  const health = await checkHealth(state.port);
  if (!health) {
    log.error("Worker service is not responding. Run `renre-kit start`");
    process.exit(1);
  }

  const spin = log.spinner("Creating backup...");

  try {
    const res = await fetch(`http://localhost:${state.port}/api/backup`, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      spin.stop(pc.red("Backup failed"));
      const body = await res.text();
      log.error(`Backup API error: ${body}`);
      process.exit(1);
    }

    const data = await res.json() as { ok?: boolean; path?: string };
    spin.stop("Backup created");

    if (data.path) {
      log.success(`Backup saved to: ${data.path}`);
    } else {
      log.success("Backup created successfully");
    }
  } catch (err) {
    spin.stop(pc.red("Backup failed"));
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Failed to create backup: ${msg}`);
    process.exit(1);
  }
}

function runListBackups(): void {
  const backupsDir = globalPaths().backupsDir;

  if (!existsSync(backupsDir)) {
    log.info("No backups directory found.");
    return;
  }

  let files: string[];
  try {
    files = readdirSync(backupsDir).filter((f) => f.endsWith(".db"));
  } catch {
    log.error("Failed to read backups directory.");
    process.exit(1);
  }

  if (files.length === 0) {
    log.info("No backups found.");
    return;
  }

  // Sort newest first by mtime
  const withStats = files
    .map((f) => {
      const filePath = join(backupsDir, f);
      const stat = statSync(filePath);
      return { name: f, size: stat.size, mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  const rows = withStats.map((f) => [
    f.name,
    humanFileSize(f.size),
    humanAge(f.mtime),
  ]);

  console.log(formatTable(["Filename", "Size", "Age"], rows));
}

async function runRestoreBackup(filename: string, opts: { yes?: boolean }): Promise<void> {
  const backupsDir = globalPaths().backupsDir;
  const backupFile = join(backupsDir, filename);
  const dataDb = globalPaths().dataDb;

  if (!existsSync(backupFile)) {
    log.error(`Backup file not found: ${filename}`);
    process.exit(1);
  }

  const state = readServerState();
  if (state) {
    const health = await checkHealth(state.port);
    if (health) {
      log.error("Stop the server first with `renre-kit stop` before restoring");
      process.exit(1);
    }
  }

  const interactive = log.isInteractive();

  if (interactive && !opts.yes) {
    const confirmed = await clack.confirm({
      message: `Restore backup "${filename}"? This will overwrite ${dataDb}`,
    });
    if (clack.isCancel(confirmed) || !confirmed) {
      log.info("Restore cancelled.");
      return;
    }
  }

  try {
    copyFileSync(backupFile, dataDb);
    log.success(`Restored ${filename} to ${dataDb}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Restore failed: ${msg}`);
    process.exit(1);
  }
}

export function registerBackupCommand(program: Command): void {
  const backup = program
    .command("backup")
    .description("Database backup and restore commands")
    .action(async () => {
      await runCreateBackup();
    });

  backup
    .command("list")
    .description("List available backups")
    .action(() => {
      runListBackups();
    });

  backup
    .command("restore <file>")
    .description("Restore database from a backup file")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (file: string, opts: { yes?: boolean }) => {
      await runRestoreBackup(file, opts);
    });
}
