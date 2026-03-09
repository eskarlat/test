CREATE TABLE IF NOT EXISTS _sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  agent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  ended_at TEXT,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON _sessions (project_id, status);
