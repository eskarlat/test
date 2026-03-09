CREATE TABLE IF NOT EXISTS _vault (
  key TEXT PRIMARY KEY,
  encrypted_value BLOB,
  iv TEXT,
  created_at TEXT,
  updated_at TEXT
);
