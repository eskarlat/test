import { Command } from "commander";
import * as clack from "@clack/prompts";
import { rmSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import * as logger from "../utils/logger.js";
import { findProjectDir, globalPaths, projectPaths } from "../utils/paths.js";
import { readProjectJson } from "../services/project-manager.js";
import { isServerRunning } from "../utils/pid.js";
import { unregisterProject } from "../services/server-client.js";

export function registerUninstallCommand(program: Command): void {
  program
    .command("uninstall")
    .description("Remove RenRe Kit from the current project")
    .option("--yes", "Skip confirmation prompt")
    .option("--keep-data", "Keep database data, only remove config")
    .action(async (options: { yes?: boolean; keepData?: boolean }) => {
      const interactive = Boolean(process.stdout.isTTY) && !options.yes;

      const projectDir = findProjectDir();
      if (!projectDir) {
        logger.error("Not in a RenRe Kit project");
        process.exit(1);
      }

      const project = readProjectJson(projectDir);
      if (!project) {
        logger.error("Could not read .renre-kit/project.json");
        process.exit(1);
      }

      if (interactive) {
        logger.intro("RenRe Kit — Uninstall");
        const confirmed = await clack.confirm({
          message: `Remove RenRe Kit from project "${project.name}"?`,
          initialValue: false,
        });
        if (clack.isCancel(confirmed) || !confirmed) {
          logger.cancel("Uninstall cancelled");
        }
      }

      const spin = logger.spinner("Uninstalling...");

      // Unregister from server if running
      if (isServerRunning()) {
        await unregisterProject(project.id);
      }

      const paths = projectPaths(projectDir);
      const gPaths = globalPaths();

      // Remove project config dir — always removed (project.json, extensions.json)
      // --keep-data only preserves the global database data and project metadata
      if (existsSync(paths.renreKitDir)) {
        rmSync(paths.renreKitDir, { recursive: true, force: true });
      }

      // Remove hooks and skills (always, regardless of --keep-data)
      if (existsSync(paths.hooksJson)) {
        unlinkSync(paths.hooksJson);
      }
      if (existsSync(paths.skillsDir)) {
        rmSync(paths.skillsDir, { recursive: true, force: true });
      }

      // Remove global project metadata (skip with --keep-data to allow re-init)
      if (!options.keepData) {
        const metaFile = join(gPaths.globalDir, "projects", `${project.id}.json`);
        if (existsSync(metaFile)) {
          unlinkSync(metaFile);
        }
      }

      spin.stop(options.keepData ? "Uninstalled (database data preserved)" : "Uninstalled");

      if (interactive) {
        logger.outro(`RenRe Kit removed from "${project.name}"`);
      } else {
        console.log(`Uninstalled: ${project.name}`);
      }
    });
}
