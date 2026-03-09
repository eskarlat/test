-- Extend _sessions with intelligence columns
ALTER TABLE _sessions ADD COLUMN prompt_count INTEGER DEFAULT 0;
ALTER TABLE _sessions ADD COLUMN tool_count INTEGER DEFAULT 0;
ALTER TABLE _sessions ADD COLUMN error_count INTEGER DEFAULT 0;
ALTER TABLE _sessions ADD COLUMN files_modified TEXT DEFAULT '[]';
ALTER TABLE _sessions ADD COLUMN decisions TEXT DEFAULT '[]';
ALTER TABLE _sessions ADD COLUMN context_injected INTEGER DEFAULT 0;
ALTER TABLE _sessions ADD COLUMN archived INTEGER DEFAULT 0;
ALTER TABLE _sessions ADD COLUMN source TEXT;

CREATE TABLE IF NOT EXISTS _session_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  summary TEXT,
  prompt_count INTEGER DEFAULT 0,
  tool_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  files_modified TEXT DEFAULT '[]',
  custom_instructions TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON _session_checkpoints (session_id);

CREATE TABLE IF NOT EXISTS _observations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  category TEXT NOT NULL DEFAULT 'general',
  confidence REAL NOT NULL DEFAULT 1.0,
  active INTEGER NOT NULL DEFAULT 1,
  last_injected_at TEXT,
  injection_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_observations_project ON _observations (project_id, active);

CREATE TABLE IF NOT EXISTS _tool_rules (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  decision TEXT NOT NULL,
  tool_type TEXT,
  reason TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  scope TEXT NOT NULL DEFAULT 'global',
  project_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_rules_scope ON _tool_rules (scope, enabled);

CREATE TABLE IF NOT EXISTS _tool_audit (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  project_id TEXT NOT NULL,
  tool_type TEXT NOT NULL,
  tool_input TEXT,
  decision TEXT NOT NULL,
  rule_id TEXT,
  extension_name TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_audit_project ON _tool_audit (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tool_audit_session ON _tool_audit (session_id);

CREATE TABLE IF NOT EXISTS _prompts (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  project_id TEXT NOT NULL,
  prompt_preview TEXT NOT NULL,
  intent_category TEXT NOT NULL DEFAULT 'general',
  context_injected INTEGER NOT NULL DEFAULT 0,
  agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompts_project ON _prompts (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prompts_session ON _prompts (session_id);

CREATE TABLE IF NOT EXISTS _agent_errors (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  project_id TEXT NOT NULL,
  error_type TEXT,
  message TEXT NOT NULL,
  stack TEXT,
  fingerprint TEXT NOT NULL,
  tool_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_errors_project ON _agent_errors (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_errors_fingerprint ON _agent_errors (fingerprint);

CREATE TABLE IF NOT EXISTS _error_patterns (
  fingerprint TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  message_template TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  session_count INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  resolve_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_error_patterns_project ON _error_patterns (project_id, status);

CREATE TABLE IF NOT EXISTS _tool_usage (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  project_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input TEXT,
  result_summary TEXT,
  file_path TEXT,
  duration_ms INTEGER,
  success INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_usage_project ON _tool_usage (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tool_usage_session ON _tool_usage (session_id);

CREATE TABLE IF NOT EXISTS _subagent_events (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  project_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  agent_type TEXT,
  parent_agent_id TEXT,
  duration_ms INTEGER,
  guidelines TEXT,
  block_decision TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subagent_project ON _subagent_events (project_id, created_at);

CREATE TABLE IF NOT EXISTS _hook_activity (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  project_id TEXT NOT NULL,
  event TEXT NOT NULL,
  feature TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hook_activity_project ON _hook_activity (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_hook_activity_session ON _hook_activity (session_id);

CREATE TABLE IF NOT EXISTS _context_recipes (
  project_id TEXT PRIMARY KEY,
  recipe TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
