import { Router, type Request, type Response } from "express";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { globalPaths } from "../core/paths.js";
import { setLogLevel, getLogLevel, type LogLevel } from "../core/logger.js";
import { logger } from "../core/logger.js";

const router = Router();

interface WorkerConfig {
  logLevel?: string;
  backup?: {
    intervalHours?: number;
    maxCount?: number;
    maxAgeDays?: number;
  };
  marketplaces?: Array<{ name: string; url: string }>;
}

function readConfig(): WorkerConfig {
  const { configFile } = globalPaths();
  if (!existsSync(configFile)) return { logLevel: "info", marketplaces: [] };
  try {
    return JSON.parse(readFileSync(configFile, "utf8")) as WorkerConfig;
  } catch {
    return { logLevel: "info", marketplaces: [] };
  }
}

function writeConfig(config: WorkerConfig): void {
  const { configFile } = globalPaths();
  try {
    writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n", "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("config", `Failed to write config: ${msg}`);
    throw err;
  }
}

// GET /api/config — return current worker config
router.get("/api/config", (_req: Request, res: Response) => {
  const config = readConfig();
  // Include live log level in response
  config.logLevel = getLogLevel();
  res.json(config);
});

// POST /api/config — save config updates
router.post("/api/config", (req: Request, res: Response) => {
  const updates = req.body as Partial<WorkerConfig>;
  const current = readConfig();
  const merged: WorkerConfig = { ...current, ...updates };

  // Apply log level immediately
  if (merged.logLevel) {
    const validLevels: LogLevel[] = ["error", "warn", "info", "debug"];
    if (validLevels.includes(merged.logLevel as LogLevel)) {
      setLogLevel(merged.logLevel as LogLevel);
    }
  }

  try {
    writeConfig(merged);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to save configuration" });
  }
});

export default router;
