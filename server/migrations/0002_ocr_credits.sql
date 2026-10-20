CREATE TABLE IF NOT EXISTS ocr_credits (
  token_hash TEXT PRIMARY KEY,
  device_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ocr_credits_device_expires ON ocr_credits(device_id, expires_at);
