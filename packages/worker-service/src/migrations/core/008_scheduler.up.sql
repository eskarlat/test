-- Extension Scheduler tables (ADR-050 §16.4)
CREATE TABLE IF NOT EXISTS _scheduler_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  extension_name TEXT NOT NULL,
  job_name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  timezone TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  timeout_ms INTEGER DEFAULT 60000,
  last_run_at TEXT,
  last_run_status TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, extension_name, job_name)
);

CREATE INDEX IF NOT EXISTS idx_scheduler_project_ext ON _scheduler_jobs(project_id, extension_name);
CREATE INDEX IF NOT EXISTS idx_scheduler_enabled ON _scheduler_jobs(enabled);

CREATE TABLE IF NOT EXISTS _scheduler_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES _scheduler_jobs(id) ON DELETE CASCADE,
  extension_name TEXT NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'timed_out')),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  duration_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_scheduler_runs_job ON _scheduler_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_scheduler_runs_ext ON _scheduler_runs(extension_name, project_id);
