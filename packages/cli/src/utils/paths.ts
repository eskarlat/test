import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

export function globalDir(): string {
  return join(homedir(), ".renre-kit");
}

export function globalPaths() {
  const base = globalDir();
  return {
    globalDir: base,
    configFile: join(base, "config.json"),
    dataDb: join(base, "data.db"),
    serverPid: join(base, "server.pid"),
    serverJson: join(base, "server.json"),
    extensionsDir: join(base, "extensions"),
    logsDir: join(base, "logs"),
    scriptsDir: join(base, "scripts"),
    backupsDir: join(base, "backups"),
    projectsDir: join(base, "projects"),
    migrationsDir: join(base, "migrations"),
  };
}

// Walk up directory tree to find .renre-kit/project.json
export function findProjectDir(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, ".renre-kit", "project.json");
    if (existsSync(candidate)) return dir;
    const parent = join(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

export function projectPaths(projectDir: string) {
  const base = join(projectDir, ".renre-kit");
  return {
    renreKitDir: base,
    projectJson: join(base, "project.json"),
    extensionsJson: join(base, "extensions.json"),
    hooksDir: join(projectDir, ".github", "hooks"),
    hooksJson: join(projectDir, ".github", "hooks", "renre-kit.json"),
    skillsDir: join(projectDir, ".github", "skills"),
    scriptsDir: join(base, "scripts"),
    gitignore: join(projectDir, ".gitignore"),
  };
}
