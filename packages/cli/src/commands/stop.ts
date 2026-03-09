import { Command } from "commander";
import * as logger from "../utils/logger.js";
import { findProjectDir } from "../utils/paths.js";
import { readProjectJson } from "../services/project-manager.js";
import { readPid, deletePid, deleteServerState, isPidAlive } from "../utils/pid.js";
import { unregisterProject, listProjects } from "../services/server-client.js";

export function registerStopCommand(program: Command): void {
  program
    .command("stop")
    .description("Stop the RenRe Kit worker service")
    .option("--force", "Kill server regardless of active projects")
    .action(async (options: { force?: boolean }) => {
      const interactive = Boolean(process.stdout.isTTY);
      if (interactive) logger.intro("RenRe Kit — Stop");

      const projectDir = findProjectDir();
      const project = projectDir ? readProjectJson(projectDir) : null;

      if (options.force) {
        await forceStop(interactive);
        return;
      }

      if (project) {
        const spin = logger.spinner("Unregistering project...");
        const ok = await unregisterProject(project.id);
        if (!ok) {
          spin.stop("Could not unregister project (server may not be running)");
        } else {
          spin.stop("Project unregistered");
        }
      }

      // Check remaining projects
      const remaining = await listProjects();
      if (remaining.length === 0) {
        await stopServer(interactive);
      } else {
        if (interactive) {
          logger.info(`${remaining.length} project(s) still active — server kept running`);
          logger.outro("Done");
        } else {
          console.log(`${remaining.length} project(s) still active — server kept running`);
        }
      }
    });
}

async function forceStop(interactive: boolean): Promise<void> {
  const pid = readPid();
  if (pid !== null && isPidAlive(pid)) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
  }
  deletePid();
  deleteServerState();
  if (interactive) {
    logger.outro("Server stopped (forced)");
  } else {
    console.log("Server stopped");
  }
}

async function stopServer(interactive: boolean): Promise<void> {
  const pid = readPid();

  if (pid !== null && isPidAlive(pid)) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
    // Wait briefly for clean shutdown
    await new Promise<void>((r) => setTimeout(r, 1000));
  }
  deletePid();
  deleteServerState();

  if (interactive) {
    logger.outro("Worker service stopped");
  } else {
    console.log("Worker service stopped");
  }
}
