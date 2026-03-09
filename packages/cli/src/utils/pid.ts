import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { globalPaths } from "./paths.js";
import { setFilePermissions } from "../shared/platform.js";

export interface ServerState {
  pid: number;
  port: number;
  startedAt: string;
  activeProjects: string[];
}

export function readPid(): number | null {
  const { serverPid } = globalPaths();
  if (!existsSync(serverPid)) return null;
  const raw = readFileSync(serverPid, "utf8").trim();
  const pid = parseInt(raw, 10);
  return isNaN(pid) ? null : pid;
}

export function writePid(pid: number): void {
  const { serverPid } = globalPaths();
  writeFileSync(serverPid, String(pid) + "\n", "utf8");
  setFilePermissions(serverPid, 0o600);
}

export function deletePid(): void {
  const { serverPid } = globalPaths();
  if (existsSync(serverPid)) unlinkSync(serverPid);
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readServerState(): ServerState | null {
  const { serverJson } = globalPaths();
  if (!existsSync(serverJson)) return null;
  try {
    const raw = readFileSync(serverJson, "utf8");
    return JSON.parse(raw) as ServerState;
  } catch {
    return null;
  }
}

export function writeServerState(state: ServerState): void {
  const { serverJson } = globalPaths();
  writeFileSync(serverJson, JSON.stringify(state, null, 2) + "\n", "utf8");
  setFilePermissions(serverJson, 0o600);
}

export function deleteServerState(): void {
  const { serverJson } = globalPaths();
  if (existsSync(serverJson)) unlinkSync(serverJson);
}

export function isServerRunning(): boolean {
  const pid = readPid();
  if (pid === null) return false;
  return isPidAlive(pid);
}
