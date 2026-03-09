// Extension Scheduler types (ADR-050 §16.4)

import type { ScopedDatabase, ExtensionLogger, MCPClient } from "../index.js";

export interface ScopedScheduler {
  register(opts: CronJobOptions): Promise<string>;
  cancel(jobId: string): Promise<void>;
  toggle(jobId: string, enabled: boolean): Promise<void>;
  list(): Promise<CronJobInfo[]>;
  runs(jobId: string, opts?: { limit?: number }): Promise<CronJobRun[]>;
}

export interface CronJobOptions {
  name: string;
  cron: string;
  timezone?: string;
  callback: (ctx: CronJobContext) => Promise<void>;
  timeoutMs?: number;
  enabled?: boolean;
  description?: string;
}

export interface CronJobContext {
  jobId: string;
  projectId: string;
  db: ScopedDatabase | null;
  logger: ExtensionLogger;
  config: Record<string, string>;
  mcp: MCPClient | null;
  signal: AbortSignal;
}

export interface CronJobInfo {
  id: string;
  name: string;
  cron: string;
  timezone?: string;
  enabled: boolean;
  description?: string;
  lastRunAt?: string;
  lastRunStatus?: string;
  nextRunAt?: string;
}

export interface CronJobRun {
  id: string;
  jobId: string;
  status: "running" | "completed" | "failed" | "timed_out";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}
