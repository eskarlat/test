import { type Request, type Response, type NextFunction } from "express";

// ---------------------------------------------------------------------------
// In-memory per-extension/action request stats with a 1-hour rolling window
// ---------------------------------------------------------------------------

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface StatEntry {
  extension: string;
  action: string;
  calls: number;
  totalLatencyMs: number;
  // Timestamps of each call within the window (for eviction)
  timestamps: number[];
}

// projectId → `${extension}::${action}` → StatEntry
const statsMap = new Map<string, Map<string, StatEntry>>();

function evictStale(entry: StatEntry, now: number): void {
  const cutoff = now - WINDOW_MS;
  let i = 0;
  while (i < entry.timestamps.length && entry.timestamps[i]! < cutoff) {
    i++;
  }
  if (i > 0) {
    // Remove stale entries — we can't recover per-call latency so we scale
    const fractionRemoved = i / entry.timestamps.length;
    entry.totalLatencyMs = Math.round(entry.totalLatencyMs * (1 - fractionRemoved));
    entry.calls -= i;
    entry.timestamps.splice(0, i);
  }
}

function record(projectId: string, extension: string, action: string, latencyMs: number): void {
  if (!statsMap.has(projectId)) {
    statsMap.set(projectId, new Map());
  }
  const proj = statsMap.get(projectId)!;
  const key = `${extension}::${action}`;
  const now = Date.now();

  if (!proj.has(key)) {
    proj.set(key, { extension, action, calls: 0, totalLatencyMs: 0, timestamps: [] });
  }
  const entry = proj.get(key)!;
  evictStale(entry, now);
  entry.calls += 1;
  entry.totalLatencyMs += latencyMs;
  entry.timestamps.push(now);
}

export interface APIStatRow {
  extension: string;
  action: string;
  calls: number;
  avgLatencyMs: number;
}

export function getStats(projectId: string): APIStatRow[] {
  const proj = statsMap.get(projectId);
  if (!proj) return [];

  const now = Date.now();
  const rows: APIStatRow[] = [];

  for (const entry of proj.values()) {
    evictStale(entry, now);
    if (entry.calls === 0) continue;
    rows.push({
      extension: entry.extension,
      action: entry.action,
      calls: entry.calls,
      avgLatencyMs: Math.round(entry.totalLatencyMs / entry.calls),
    });
  }

  // Sort by most calls first
  rows.sort((a, b) => b.calls - a.calls);
  return rows;
}

// ---------------------------------------------------------------------------
// Express middleware — tracks requests matching /api/:projectId/:extension/*
// URL pattern: /api/{projectId}/{extension}/{action...}
// ---------------------------------------------------------------------------

const TRACKED_PATH_RE = /^\/api\/([^/]+)\/([^/]+)(\/(.+))?$/;

export function requestTrackerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const match = TRACKED_PATH_RE.exec(req.path);
    if (!match) return;

    const [, projectId, segment, , actionSuffix] = match;
    if (!projectId || !segment) return;

    // Skip internal/core routes that aren't extension-namespaced
    const coreSegments = new Set([
      "projects",
      "events",
      "errors",
      "vault",
      "hooks",
      "logs",
      "stats",
      "mcp",
      "sessions",
      "config",
      "backup",
    ]);
    if (coreSegments.has(segment)) return;

    const action = actionSuffix ?? req.method.toLowerCase();
    const latencyMs = Date.now() - start;
    record(projectId, segment, action, latencyMs);
  });

  next();
}
