CREATE TABLE IF NOT EXISTS debug_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  version TEXT NOT NULL,
  session_id TEXT,
  outcome TEXT NOT NULL,
  paywall TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  successful INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  browser TEXT, os TEXT, device_class TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS debug_logs_created ON debug_logs(created_at);
CREATE INDEX IF NOT EXISTS debug_logs_outcome ON debug_logs(outcome);
CREATE INDEX IF NOT EXISTS debug_logs_version ON debug_logs(version);
