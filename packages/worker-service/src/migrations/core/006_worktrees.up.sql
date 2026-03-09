CREATE TABLE _worktrees (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  branch TEXT NOT NULL,
  base_branch TEXT,
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'ready', 'in_use', 'completed', 'error', 'removing')),
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('automation', 'chat', 'user')),
  created_by_automation_id TEXT,
  created_by_automation_run_id TEXT,
  created_by_chat_session_id TEXT,
  cleanup_policy TEXT NOT NULL DEFAULT 'always'
    CHECK (cleanup_policy IN ('always', 'on_success', 'never', 'ttl')),
  ttl_ms INTEGER,
  disk_usage_bytes INTEGER,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_accessed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  error TEXT
);

CREATE INDEX idx_worktrees_project ON _worktrees (project_id);
CREATE INDEX idx_worktrees_status ON _worktrees (project_id, status);
CREATE INDEX idx_worktrees_automation ON _worktrees (created_by_automation_id);
CREATE INDEX idx_worktrees_cleanup ON _worktrees (cleanup_policy, status);
