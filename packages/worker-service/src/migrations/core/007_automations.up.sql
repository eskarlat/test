CREATE TABLE _automations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('cron', 'once', 'manual')),
  schedule_cron TEXT,
  schedule_timezone TEXT,
  schedule_run_at TEXT,
  schedule_starts_at TEXT,
  schedule_ends_at TEXT,
  chain_json TEXT NOT NULL,
  system_prompt TEXT,
  variables_json TEXT,
  worktree_json TEXT,
  max_duration_ms INTEGER DEFAULT 300000,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_automations_project ON _automations (project_id);
CREATE INDEX idx_automations_enabled ON _automations (project_id, enabled);

CREATE TABLE _automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'completed_with_warnings', 'failed', 'cancelled', 'timed_out')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  error TEXT,
  step_count INTEGER DEFAULT 0,
  steps_completed INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  worktree_id TEXT,
  worktree_branch TEXT,
  worktree_path TEXT,
  worktree_status TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (automation_id) REFERENCES _automations(id) ON DELETE CASCADE
);

CREATE INDEX idx_runs_automation ON _automation_runs (automation_id);
CREATE INDEX idx_runs_project_status ON _automation_runs (project_id, status);
CREATE INDEX idx_runs_started ON _automation_runs (started_at);

CREATE TABLE _automation_step_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  model TEXT,
  reasoning_effort TEXT,
  resolved_prompt TEXT,
  system_prompt TEXT,
  response TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  on_error_strategy TEXT,
  timeout_ms INTEGER,
  FOREIGN KEY (run_id) REFERENCES _automation_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_step_logs_run ON _automation_step_logs (run_id);

CREATE TABLE _automation_tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_log_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('built-in', 'extension', 'mcp')),
  extension_name TEXT,
  arguments_json TEXT,
  result_json TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  auto_approved INTEGER DEFAULT 0,
  error TEXT,
  started_at TEXT,
  duration_ms INTEGER,
  FOREIGN KEY (step_log_id) REFERENCES _automation_step_logs(id) ON DELETE CASCADE
);

CREATE INDEX idx_tool_calls_step ON _automation_tool_calls (step_log_id);
