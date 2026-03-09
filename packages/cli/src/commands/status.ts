import { Command } from "commander";
import pc from "picocolors";
import { findProjectDir } from "../utils/paths.js";
import { readProjectJson, type ProjectJson } from "../services/project-manager.js";
import { readPid, isPidAlive, readServerState, type ServerState } from "../utils/pid.js";
import { checkHealth, listProjects, type HealthResponse, type ProjectInfo } from "../services/server-client.js";
import { readConfig, type Config } from "../utils/config.js";
import { formatJson, formatExtensionDetail } from "../utils/formatter.js";

interface StatusOptions {
  project?: string;
  json?: boolean;
  short?: boolean;
}

interface StatusData {
  pid: number | null;
  serverRunning: boolean;
  serverState: ServerState | null;
  config: Config;
  health: HealthResponse | null;
  projects: ProjectInfo[];
  currentProject: ProjectJson | null;
  currentProjectInfo: ProjectInfo | undefined;
}

async function collectStatusData(): Promise<StatusData> {
  const pid = readPid();
  const serverRunning = pid !== null && isPidAlive(pid);
  const serverState = readServerState();
  const config = readConfig();
  const health = serverRunning && serverState ? await checkHealth(serverState.port) : null;
  const projects = serverRunning ? await listProjects() : [];
  const projectDir = findProjectDir();
  const currentProject = projectDir ? readProjectJson(projectDir) : null;
  const currentProjectInfo = currentProject
    ? projects.find((p) => p.id === currentProject.id)
    : undefined;
  return { pid, serverRunning, serverState, config, health, projects, currentProject, currentProjectInfo };
}

function buildJsonOutput(data: StatusData): object {
  const { serverRunning, pid, serverState, health, config, currentProjectInfo, projects } = data;
  return {
    server: {
      running: serverRunning,
      pid: serverRunning ? pid : null,
      port: serverState?.port ?? null,
      startedAt: serverState?.startedAt ?? null,
      uptime: health?.uptime ?? null,
      memoryUsage: health?.memoryUsage ?? null,
      logLevel: config.logLevel,
    },
    currentProject: currentProjectInfo ?? null,
    activeProjects: projects,
    marketplaces: config.marketplaces,
  };
}

function printShortStatus(data: StatusData): void {
  if (data.serverRunning) {
    console.log(`running port=${data.serverState?.port} projects=${data.projects.length}`);
  } else {
    console.log("stopped");
  }
}

function printServerSection(data: StatusData): void {
  const { serverRunning, health, serverState, config, pid } = data;
  console.log(pc.dim("Server"));
  if (serverRunning && health) {
    console.log(`  Status:     ${pc.green("running")}`);
    console.log(`  Port:       ${serverState!.port}`);
    console.log(`  PID:        ${pid}`);
    console.log(`  Uptime:     ${formatUptime(health.uptime)}`);
    console.log(`  Memory:     ${formatMemory(health.memoryUsage.heapUsed)}`);
    console.log(`  Log level:  ${config.logLevel}`);
  } else if (serverState) {
    console.log(`  Status:     ${pc.red("stopped")}`);
    console.log(`  Last run:   ${serverState.startedAt} (port ${serverState.port})`);
  } else {
    console.log(`  Status:     ${pc.red("not running")}`);
  }
  console.log("");
}

function printCurrentProjectSection(data: StatusData): void {
  const { currentProject, currentProjectInfo } = data;
  if (!currentProject) return;
  console.log(pc.dim("Current Project"));
  console.log(`  Name:   ${currentProject.name}`);
  console.log(`  ID:     ${currentProject.id}`);
  if (currentProjectInfo) {
    const exts = currentProjectInfo.mountedExtensions;
    if (exts.length === 0) {
      console.log(`  Extensions: (none)`);
    } else {
      console.log(`  Extensions:`);
      for (const ext of exts) {
        const sym = ext.status === "mounted" ? pc.green("\u2713") : pc.red("\u2717");
        console.log(`    ${sym} ${ext.name}@${ext.version} ${ext.status} (${formatExtensionDetail(ext)})`);
      }
    }
  }
  console.log("");
}

function printActiveProjectsSection(data: StatusData): void {
  if (data.projects.length === 0) return;
  console.log(pc.dim("Active Projects"));
  for (const p of data.projects) {
    console.log(`  ${p.name} (${p.id}) \u2014 ${p.extensionCount} extension(s)`);
  }
  console.log("");
}

function printMarketplacesSection(data: StatusData): void {
  console.log(pc.dim("Marketplaces"));
  for (const m of data.config.marketplaces) {
    console.log(`  ${m.name}`);
  }
  console.log("");
}

function printFullStatus(data: StatusData): void {
  console.log("");
  console.log(pc.bold("RenRe Kit Status"));
  console.log("");
  printServerSection(data);
  printCurrentProjectSection(data);
  printActiveProjectsSection(data);
  printMarketplacesSection(data);
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show status of the worker service and current project")
    .option("--project <id>", "Show status for specific project ID")
    .option("--json", "Output as JSON")
    .option("--short", "One-line summary")
    .action(async (options: StatusOptions) => {
      const data = await collectStatusData();
      if (options.project) {
        data.projects = data.projects.filter((p) => p.id === options.project);
        if (data.currentProject && data.currentProject.id !== options.project) {
          data.currentProject = null;
          data.currentProjectInfo = undefined;
        }
      }
      if (options.json) { console.log(formatJson(buildJsonOutput(data))); return; }
      if (options.short) { printShortStatus(data); return; }
      printFullStatus(data);
    });
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function formatMemory(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}
