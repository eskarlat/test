import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function setFilePermissions(filePath: string, mode: number): void {
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, mode);
  }
  // Windows: rely on user profile directory ACLs
}

export function getPlatformSignals(): NodeJS.Signals[] {
  return ["SIGINT", "SIGTERM", "SIGBREAK"];
}

export function resolvePaths() {
  const globalDir = path.join(os.homedir(), ".renre-kit");
  return {
    globalDir,
    configFile: path.join(globalDir, "config.json"),
    dataDb: path.join(globalDir, "data.db"),
    serverPid: path.join(globalDir, "server.pid"),
    serverJson: path.join(globalDir, "server.json"),
    extensionsDir: path.join(globalDir, "extensions"),
    logsDir: path.join(globalDir, "logs"),
    scriptsDir: path.join(globalDir, "scripts"),
    backupsDir: path.join(globalDir, "backups"),
  };
}
