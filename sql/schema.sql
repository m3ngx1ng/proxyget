CREATE TABLE IF NOT EXISTS proxies (
  protocol TEXT NOT NULL,
  ip TEXT NOT NULL,
  port INTEGER NOT NULL,
  source TEXT NOT NULL,
  validated INTEGER NOT NULL DEFAULT 0,
  validation_mode TEXT NOT NULL DEFAULT 'source',
  score REAL NOT NULL DEFAULT 0.5,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_checked_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  total_validations INTEGER NOT NULL DEFAULT 0,
  successful_validations INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (protocol, ip, port)
);

CREATE INDEX IF NOT EXISTS idx_proxies_protocol_score ON proxies(protocol, score DESC);
CREATE INDEX IF NOT EXISTS idx_proxies_validated_score ON proxies(validated, score DESC);
CREATE INDEX IF NOT EXISTS idx_proxies_last_seen ON proxies(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS fetchers (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  last_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fetcher_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
