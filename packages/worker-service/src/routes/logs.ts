import { Router, type Request, type Response } from "express";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { globalPaths } from "../core/paths.js";

const router = Router();

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  source: string;
  message: string;
}

// Regex matching the log format: [ISO] [LEVEL] [source] message
const LOG_LINE_RE = /^\[([^\]]+)\] \[([A-Z]+)\] \[([^\]]+)\] (.+)$/;

function parseTodayLogs(limit: number): LogEntry[] {
  const { logsDir } = globalPaths();
  const today = new Date().toISOString().slice(0, 10);
  const logFile = join(logsDir, `${today}.txt`);

  if (!existsSync(logFile)) return [];

  try {
    const content = readFileSync(logFile, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const entries: LogEntry[] = [];

    for (const line of lines) {
      const match = LOG_LINE_RE.exec(line);
      if (!match) continue;
      const [, timestamp, levelRaw, source, message] = match;
      const level = levelRaw!.toLowerCase() as LogEntry["level"];
      if (!["info", "warn", "error", "debug"].includes(level)) continue;
      entries.push({ timestamp: timestamp!, level, source: source!, message: message! });
    }

    // Most-recent first, then limit
    return entries.reverse().slice(0, limit);
  } catch {
    return [];
  }
}

function filterByProject(entries: LogEntry[], _projectId: string): LogEntry[] {
  // Sources look like: worker, ext:name, mcp:name, vault, cli, etc.
  // We can't perfectly scope to a projectId from log text alone, so we return all
  // and let the UI filter. The _projectId param is kept for API contract compliance.
  return entries;
}

// GET /api/logs?limit=N — global log entries for today
router.get("/api/logs", (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "200"), 10) || 200, 1000);
  const entries = parseTodayLogs(limit);
  res.json(entries);
});

// GET /api/:projectId/logs?limit=N — project-scoped log entries
router.get("/api/:projectId/logs", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "100"), 10) || 100, 500);
  const all = parseTodayLogs(limit * 2); // read more to allow for filtering
  const filtered = filterByProject(all, projectId!);
  res.json(filtered.slice(0, limit));
});

export default router;
