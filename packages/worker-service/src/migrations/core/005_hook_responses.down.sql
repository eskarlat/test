-- SQLite does not support DROP COLUMN before 3.35.0;
-- recreate the table without output_snapshot
CREATE TABLE _hook_activity_old AS SELECT
  id, session_id, project_id, event, feature, duration_ms, success, error, created_at
FROM _hook_activity;
DROP TABLE _hook_activity;
ALTER TABLE _hook_activity_old RENAME TO _hook_activity;
CREATE INDEX IF NOT EXISTS idx_hook_activity_project ON _hook_activity (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_hook_activity_session ON _hook_activity (session_id);
