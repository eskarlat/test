import { Command } from "commander";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import * as logger from "../utils/logger.js";
import { findProjectDir, globalPaths } from "../utils/paths.js";
import { formatExtensionDetail } from "../utils/formatter.js";
import { readProjectJson, readExtensionsJson, type ProjectJson } from "../services/project-manager.js";
import {
  readPid, writePid, writeServerState, isPidAlive,
  readServerState,
} from "../utils/pid.js";
import {
  checkHealth, isRenreKitServer, registerProject,
} from "../services/server-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FALLBACK_PORTS = Array.from({ length: 10 }, (_, i) => 42888 + i);

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start the RenRe Kit worker service")
    .option("--port <port>", "Override default port 42888", "42888")
    .option("--no-browser", "Do not open browser")
    .action(async (options: { port: string; browser: boolean }) => {
      const { project, projectDir } = resolveProjectOrExit();
      const interactive = Boolean(process.stdout.isTTY);
      if (interactive) logger.intro("RenRe Kit — Start");

      if (await handleAlreadyRunning(project, projectDir, interactive)) return;

      const port = await findAvailablePort(parseInt(options.port, 10));
      const pid = await launchWorker(port, interactive);

      writePid(pid);
      writeServerState({
        pid,
        port,
        startedAt: new Date().toISOString(),
        activeProjects: [],
      });

      await doRegister(project.id, project.name, projectDir, port, interactive);

      const consoleUrl = `http://localhost:${port}`;
      const networkIp = getNetworkAddress();
      const networkUrl = networkIp ? `http://${networkIp}:${port}` : null;
      if (interactive) {
        logger.outro(`Console running at ${consoleUrl}`);
        if (networkUrl) logger.info(`Network: ${networkUrl}`);
      } else {
        console.log(`Worker started on port ${port}`);
        console.log(`Console running at ${consoleUrl}`);
        if (networkUrl) console.log(`Network: ${networkUrl}`);
      }

      if (options.browser) openBrowser(consoleUrl);
      void checkForUpdates(projectDir);
    });
}

function resolveProjectOrExit(): { project: ProjectJson; projectDir: string } {
  const projectDir = findProjectDir();
  if (!projectDir) {
    logger.error("Not in a RenRe Kit project. Run `renre-kit init` first.");
    process.exit(1);
  }
  const project = readProjectJson(projectDir);
  if (!project) {
    logger.error("Could not read .renre-kit/project.json");
    process.exit(1);
  }
  return { project, projectDir };
}

async function handleAlreadyRunning(
  project: ProjectJson,
  projectDir: string,
  interactive: boolean,
): Promise<boolean> {
  const existingPid = readPid();
  if (existingPid === null || !isPidAlive(existingPid)) return false;

  const existingState = readServerState();
  const health = existingState ? await checkHealth(existingState.port) : null;

  if (health) {
    logger.info(`Worker already running on port ${existingState!.port}`);
    await doRegister(project.id, project.name, projectDir, existingState!.port, interactive);
    const existingNetworkIp = getNetworkAddress();
    const existingNetworkUrl = existingNetworkIp ? `http://${existingNetworkIp}:${existingState!.port}` : null;
    if (interactive) {
      logger.outro(`Console running at http://localhost:${existingState!.port}`);
      if (existingNetworkUrl) logger.info(`Network: ${existingNetworkUrl}`);
    } else {
      console.log(`Console running at http://localhost:${existingState!.port}`);
      if (existingNetworkUrl) console.log(`Network: ${existingNetworkUrl}`);
    }
    return true;
  }

  logger.warn(`Found stale PID ${existingPid}, cleaning up...`);
  try { process.kill(existingPid, "SIGTERM"); } catch { /* already dead */ }
  return false;
}

async function findAvailablePort(preferredPort: number): Promise<number> {
  for (const p of FALLBACK_PORTS) {
    if (p === preferredPort) {
      if (await isRenreKitServer(p)) return p;
      if (!await isPortListening(p)) return p;
    } else if (!await isPortListening(p)) {
      return p;
    }
  }
  return preferredPort;
}

async function launchWorker(port: number, interactive: boolean): Promise<number> {
  const workerEntry = resolveWorkerEntry();
  const spin = logger.spinner(`Starting worker on port ${port}...`);

  const child = spawn(process.execPath, [workerEntry], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, RENRE_KIT_PORT: String(port) },
  });
  child.unref();

  const pid = child.pid!;
  const alive = await waitForHealth(port, 10000);
  if (!alive) {
    spin.stop("Failed to start worker service");
    if (interactive) logger.error("Worker did not respond within 10 seconds");
    process.exit(1);
  }
  spin.stop(`Worker started on port ${port}`);
  return pid;
}

async function doRegister(
  projectId: string,
  projectName: string,
  projectDir: string,
  _port: number,
  interactive: boolean,
): Promise<void> {
  const result = await registerProject(projectId, projectName, projectDir);
  if (!result) {
    logger.warn("Could not register project with worker");
    return;
  }
  if (result.extensions.length > 0) {
    for (const ext of result.extensions) {
      const statusSym = ext.status === "mounted" ? "\u2713" : "\u2717";
      const detail = formatExtensionDetail(ext);
      if (interactive) {
        logger.info(`  ${statusSym} ${ext.name}@${ext.version} ${ext.status} (${detail})`);
      }
    }
  }
}

async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const health = await checkHealth(port);
    if (health) return true;
    await new Promise<void>((r) => setTimeout(r, 500));
  }
  return false;
}

async function isPortListening(port: number): Promise<boolean> {
  try {
    const { createServer } = await import("node:net");
    return new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(true));
      server.once("listening", () => { server.close(); resolve(false); });
      server.listen(port, "127.0.0.1");
    });
  } catch {
    return false;
  }
}

function resolveWorkerEntry(): string {
  return join(__dirname, "..", "..", "worker-service", "dist", "index.js");
}

function resolveBrowserCommand(url: string): { bin: string; args: string[] } {
  if (process.platform === "win32") return { bin: "cmd", args: ["/c", "start", url] };
  if (process.platform === "darwin") return { bin: "open", args: [url] };
  return { bin: "xdg-open", args: [url] };
}

function openBrowser(url: string): void {
  try {
    const { bin, args } = resolveBrowserCommand(url);
    spawn(bin, args, { detached: true, stdio: "ignore" }).unref();
  } catch { /* browser open is best-effort */ }
}

interface CachedMarketplace {
  extensions: Array<{ name: string; version: string }>;
}

interface MarketplaceCache {
  marketplaces: CachedMarketplace[];
  fetchedAt: string;
}

async function checkForUpdates(projectDir: string): Promise<void> {
  try {
    const { globalDir } = globalPaths();
    const cacheFile = join(globalDir, "marketplace-cache.json");
    if (!existsSync(cacheFile)) return;

    const cache = JSON.parse(readFileSync(cacheFile, "utf8")) as MarketplaceCache;
    const allCached = (cache.marketplaces ?? []).flatMap((m) => m.extensions ?? []);
    const extensionsJson = readExtensionsJson(projectDir);
    if (!extensionsJson) return;

    const updates: string[] = [];
    for (const installed of extensionsJson.extensions) {
      const latest = allCached.find((e) => e.name === installed.name);
      if (latest && latest.version !== installed.version) {
        updates.push(`${installed.name} (${installed.version} → ${latest.version})`);
      }
    }

    if (updates.length > 0) {
      logger.info(`Updates available: ${updates.join(", ")}. Run \`renre-kit marketplace upgrade\` to update.`);
    }
  } catch { /* update check is non-blocking, ignore all errors */ }
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
