import { Command } from "commander";
import * as clack from "@clack/prompts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import * as logger from "../utils/logger.js";
import { globalPaths, projectPaths } from "../utils/paths.js";
import { writeProjectJson, writeExtensionsJson, writeGlobalProjectMeta } from "../services/project-manager.js";
import { ensureDefaultConfig } from "../utils/config.js";
import { SCHEMA_BASE_URL } from "../shared/urls.js";
import { installLearnSkill } from "../services/skill-manager.js";
import { generateCoreHookFile } from "../services/hook-file-generator.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize RenRe Kit in the current project")
    .option("--name <name>", "Project name (non-interactive)")
    .option("--yes", "Skip all prompts")
    .action(async (options: { name?: string; yes?: boolean }) => {
      const cwd = process.cwd();
      const paths = projectPaths(cwd);
      const gPaths = globalPaths();

      // Check if already initialized
      if (existsSync(paths.renreKitDir)) {
        logger.error(`Already initialized: ${paths.renreKitDir} already exists`);
        process.exit(1);
      }

      const interactive = Boolean(process.stdout.isTTY) && !options.yes;
      let projectName: string;

      if (interactive) {
        logger.intro("RenRe Kit — Init");
        const nameResult = await clack.text({
          message: "Project name",
          defaultValue: basename(cwd),
          placeholder: basename(cwd),
        });
        if (clack.isCancel(nameResult)) {
          logger.cancel("Init cancelled");
        }
        projectName = nameResult as string;
      } else {
        projectName = options.name ?? basename(cwd);
      }

      const projectId = crypto.randomUUID();

      // Create global dirs
      mkdirSync(gPaths.globalDir, { recursive: true });
      mkdirSync(gPaths.backupsDir, { recursive: true });
      mkdirSync(join(gPaths.globalDir, "projects"), { recursive: true });
      mkdirSync(gPaths.scriptsDir, { recursive: true });
      ensureDefaultConfig();

      // Create project dirs
      mkdirSync(paths.renreKitDir, { recursive: true });
      mkdirSync(paths.skillsDir, { recursive: true });

      // Write project.json
      writeProjectJson(cwd, {
        $schema: `${SCHEMA_BASE_URL}/project.json`,
        id: projectId,
        name: projectName,
      });

      // Write extensions.json
      writeExtensionsJson(cwd, {
        $schema: `${SCHEMA_BASE_URL}/extensions.json`,
        extensions: [],
      });

      // Write core hooks file
      generateCoreHookFile(cwd);

      // Install the built-in /learn skill
      installLearnSkill(cwd);

      // Update .gitignore
      updateGitignore(cwd);

      // Write global project metadata
      writeGlobalProjectMeta(projectId, {
        id: projectId,
        name: projectName,
        path: cwd,
        createdAt: new Date().toISOString(),
      });

      if (interactive) {
        logger.outro(`Project initialized: ${projectName} (${projectId})`);
      } else {
        console.log(`Initialized project: ${projectName} (${projectId})`);
      }
    });
}

function updateGitignore(projectDir: string): void {
  const gitignorePath = join(projectDir, ".gitignore");
  const entry = ".renre-kit/";
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf8");
    if (!content.includes(entry)) {
      const sep = content.endsWith("\n") ? "" : "\n";
      writeFileSync(gitignorePath, content + sep + entry + "\n", "utf8");
    }
  } else {
    writeFileSync(gitignorePath, entry + "\n", "utf8");
  }
}
