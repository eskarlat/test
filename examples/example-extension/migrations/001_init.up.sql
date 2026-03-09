CREATE TABLE IF NOT EXISTS ext_example_extension_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ext_example_extension_items_project
  ON ext_example_extension_items (project_id);
