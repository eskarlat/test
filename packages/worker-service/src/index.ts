import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { networkInterfaces } from "node:os";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { copyFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { createApp } from "./app.js";
import { attachSocketBridge } from "./core/socket-bridge.js";
import { copilotBridge } from "./core/copilot-bridge.js";
import { dbManager } from "./core/db-manager.js";
import { startMemoryMonitor, getRegistry as getExtensionRegistry } from "./core/extension-registry.js";
import { logger, setLogLevel, type LogLevel } from "./core/logger.js";
import { globalPaths } from "./core/paths.js";
import {
  shouldRunPeriodicBackup,
  createPeriodicBackup,
  pruneBackups,
  type BackupRetentionConfig,
} from "./core/backup-manager.js";
import { setFilePermissions } from "./shared/platform.js";
import { setServerPort } from "./core/server-port.js";
import { checkAndEmitUpdates } from "./core/update-checker.js";
import { getRegistry as getProjectRegistry } from "./routes/projects.js";
import { runAutoPurge } from "./core/auto-purge-scheduler.js";
import { WorktreeManager } from "./core/worktree-manager.js";
import { setWorktreeManager } from "./routes/worktrees.js";
import { AutomationEngine } from "./core/automation-engine.js";
import {
  setAutomationEngine,
  setCopilotBridge as setAutomationCopilotBridge,
  setDb as setAutomationDb,
} from "./routes/automations.js";
import { setExtensionLoaderIO } from "./core/extension-loader.js";
import { setExtCronDb } from "./routes/ext-cron.js";

interface BackupConfig {
  intervalHours?: number;
  maxCount?: number;
  maxAgeDays?: number;
}

interface ServerConfig {
  logLevel?: LogLevel;
  backup?: BackupConfig;
}

// Module-level Socket.IO instance for use by chat routes (Phase 4)
let ioInstance: SocketIOServer | null = null;

// Module-level WorktreeManager instance for shutdown access
let worktreeManagerInstance: WorktreeManager | null = null;

// Module-level AutomationEngine instance for shutdown access
let automationEngineInstance: AutomationEngine | null = null;

export function getSocketIO(): SocketIOServer | null {
  return ioInstance;
}

export function getWorktreeManager(): WorktreeManager | null {
  return worktreeManagerInstance;
}

async function findAvailablePort(preferred: number): Promise<number> {
  const ports = Array.from({ length: 10 }, (_, i) => preferred + i);
  for (const port of ports) {
    if (await isPortAvailable(port)) return port;
    if (await isExistingRenreKitInstance(port)) return port;
  }
  throw new Error("No available ports in range 42888-42897");
}

async function isExistingRenreKitInstance(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) {
      const data = await res.json() as { status?: string };
      if (data.status === "ok") {
        logger.info("worker", `Reusing existing renre-kit instance on port ${port}`);
        return true;
      }
    }
  } catch { /* port not responding */ }
  return false;
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => { server.close(); resolve(true); });
    server.listen(port, "0.0.0.0");
  });
}

function writePidFile(pid: number, port: number): void {
  const { serverPid, serverJson } = globalPaths();
  writeFileSync(serverPid, String(pid) + "\n", "utf8");
  setFilePermissions(serverPid, 0o600);

  const state = {
    pid,
    port,
    startedAt: new Date().toISOString(),
    activeProjects: [] as string[],
  };
  writeFileSync(serverJson, JSON.stringify(state, null, 2) + "\n", "utf8");
  setFilePermissions(serverJson, 0o600);
}

function cleanupPidFiles(): void {
  const { serverPid } = globalPaths();
  if (existsSync(serverPid)) unlinkSync(serverPid);
  // Keep server.json for "last run" history
}

function copyCoresMigrations(): void {
  const { coreMigrationsDir } = globalPaths();
  mkdirSync(coreMigrationsDir, { recursive: true });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const bundledMigrationsDir = join(__dirname, "migrations", "core");

  if (!existsSync(bundledMigrationsDir)) return;

  for (const file of readdirSync(bundledMigrationsDir)) {
    const dest = join(coreMigrationsDir, file);
    // Only copy if destination doesn't already exist (don't overwrite user-modified migrations)
    if (!existsSync(dest)) {
      copyFileSync(join(bundledMigrationsDir, file), dest);
    }
  }
}

function deployHookScript(): void {
  const { scriptsDir } = globalPaths();
  mkdirSync(scriptsDir, { recursive: true });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const src = join(__dirname, "scripts", "worker-service.cjs");
  const dest = join(scriptsDir, "worker-service.cjs");

  if (existsSync(src)) {
    copyFileSync(src, dest);
  }
}

function loadConfig(configFile: string): ServerConfig {
  try {
    if (existsSync(configFile)) {
      return JSON.parse(readFileSync(configFile, "utf8")) as ServerConfig;
    }
  } catch { /* use defaults */ }
  return {};
}

function applyBackupSchedule(intervalHours: number, retention: BackupRetentionConfig): void {
  if (shouldRunPeriodicBackup(intervalHours)) {
    try {
      createPeriodicBackup();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("backup", `Periodic backup failed: ${msg}`);
    }
  }
  pruneBackups(retention);
}

function stopAllExtensionSchedulers(): void {
  const registry = getExtensionRegistry();
  for (const extensions of registry.values()) {
    for (const entry of extensions.values()) {
      if (entry.loaded?.scheduler) {
        entry.loaded.scheduler.stopAll();
      }
    }
  }
}

function registerShutdownHandlers(httpServer: HttpServer, io: SocketIOServer): void {
  function shutdown(signal: string): void {
    logger.info("worker", `Received ${signal}, shutting down...`);

    const forceExit = setTimeout(() => {
      logger.error("worker", "Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 5000);
    forceExit.unref();

    // Stop AutomationEngine before WorktreeManager (cleanup timers, cancel runs)
    automationEngineInstance?.stop();

    // Stop all extension schedulers
    stopAllExtensionSchedulers();

    // Stop WorktreeManager (cleanup timers)
    worktreeManagerInstance?.stop();

    // Shutdown CopilotBridge before Socket.IO
    copilotBridge.shutdown().catch(() => {});

    // Close Socket.IO before HTTP server (ADR-048)
    io.close(() => {
      httpServer.close(() => {
        dbManager.close();
        cleanupPidFiles();
        logger.info("worker", "Worker service stopped");
        process.exit(0);
      });
    });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  // SIGBREAK is Windows-only
  if (process.platform === "win32") {
    process.on("SIGBREAK" as NodeJS.Signals, () => shutdown("SIGBREAK"));
  }
}

function getNetworkAddress(): string | null {
  const interfaces = networkInterfaces();
  for (const infos of Object.values(interfaces)) {
    if (!infos) continue;
    for (const info of infos) {
      if (info.family === "IPv4" && !info.internal) return info.address;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const preferredPort = parseInt(process.env["RENRE_KIT_PORT"] ?? "42888", 10);

  // Ensure global dirs exist
  const paths = globalPaths();
  mkdirSync(paths.globalDir, { recursive: true });
  mkdirSync(paths.logsDir, { recursive: true });
  mkdirSync(paths.backupsDir, { recursive: true });

  logger.info("worker", "Worker service starting...");

  // Initialize database and run migrations
  dbManager.initialize();
  copyCoresMigrations();
  dbManager.runCoreMigrations();

  // Deploy hook entry point script to ~/.renre-kit/scripts/
  deployHookScript();

  // Apply config
  const config = loadConfig(paths.configFile);
  if (config.logLevel) setLogLevel(config.logLevel);

  applyBackupSchedule(
    config.backup?.intervalHours ?? 24,
    {
      maxCount: config.backup?.maxCount ?? 10,
      maxAgeDays: config.backup?.maxAgeDays ?? 30,
    },
  );

  // Start server with Socket.IO (ADR-048)
  const port = await findAvailablePort(preferredPort);
  const app = createApp();
  const httpServer = createHttpServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
    pingInterval: 25000,
    pingTimeout: 20000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 120000, // 2 min buffer
    },
  });

  ioInstance = io;
  copilotBridge.setIO(io);
  attachSocketBridge(io);
  setExtensionLoaderIO(io);
  setExtCronDb(dbManager.getConnection());

  // Initialize WorktreeManager and wire into routes (ADR-051, Phase 2)
  const worktreeManager = new WorktreeManager(dbManager.getConnection(), io);
  worktreeManagerInstance = worktreeManager;
  setWorktreeManager(worktreeManager);
  await worktreeManager.start();

  // Initialize AutomationEngine and wire into routes (ADR-050, Phase 5)
  const automationEngine = new AutomationEngine(dbManager.getConnection(), io);
  automationEngine.setCopilotBridge(copilotBridge);
  automationEngine.setWorktreeManager(worktreeManager);
  automationEngineInstance = automationEngine;
  setAutomationEngine(automationEngine);
  setAutomationCopilotBridge(copilotBridge);
  setAutomationDb(dbManager.getConnection());
  automationEngine.start();

  httpServer.listen(port, "0.0.0.0", () => {
    writePidFile(process.pid, port);
    setServerPort(port);
    logger.info("worker", `Worker service started on port ${port} (Socket.IO enabled)`);
    console.log(`Worker service started on port ${port}`);
    console.log(`  Local:   http://localhost:${port}`);
    const networkAddress = getNetworkAddress();
    if (networkAddress) {
      console.log(`  Network: http://${networkAddress}:${port}`);
    }
  });

  registerShutdownHandlers(httpServer, io);
  startMemoryMonitor();
  runAutoPurge();

  // Run update check 30s after start so the server is ready and projects can register
  const updateCheckTimer = setTimeout(() => {
    checkAndEmitUpdates(getProjectRegistry()).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("update-checker", `Update check failed: ${msg}`);
    });
  }, 30_000);
  updateCheckTimer.unref();
}

void main();
