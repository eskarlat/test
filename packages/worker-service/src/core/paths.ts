import { join } from "node:path";
import { homedir } from "node:os";

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
    coreMigrationsDir: join(base, "migrations", "core"),
  };
}
