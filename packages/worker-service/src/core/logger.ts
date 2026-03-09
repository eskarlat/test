import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { globalPaths } from "./paths.js";

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let configuredLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  configuredLevel = level;
}

export function getLogLevel(): LogLevel {
  return configuredLevel;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureLogsDir(): string {
  const { logsDir } = globalPaths();
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[configuredLevel];
}

function writeLog(level: LogLevel, source: string, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] [${source}] ${message}\n`;
  const logsDir = ensureLogsDir();
  appendFileSync(join(logsDir, `${todayStr()}.txt`), line, "utf8");

  if (level === "error") {
    const errorEntry = JSON.stringify({
      timestamp: ts,
      level,
      source,
      message,
      ...(meta ? { meta } : {}),
    }) + "\n";
    appendFileSync(join(logsDir, `error-${todayStr()}.json`), errorEntry, "utf8");
  }
}

export const logger = {
  error(source: string, message: string, meta?: Record<string, unknown>): void {
    writeLog("error", source, message, meta);
  },
  warn(source: string, message: string, meta?: Record<string, unknown>): void {
    writeLog("warn", source, message, meta);
  },
  info(source: string, message: string, meta?: Record<string, unknown>): void {
    writeLog("info", source, message, meta);
  },
  debug(source: string, message: string, meta?: Record<string, unknown>): void {
    writeLog("debug", source, message, meta);
  },
};
