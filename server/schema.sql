CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, revision INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, payload TEXT NOT NULL,
  password_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS share_sessions (
  token_hash TEXT PRIMARY KEY, share_id TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, trip_id TEXT NOT NULL, resource_id TEXT, stop_id TEXT,
  name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_trip ON attachments(trip_id);
CREATE TABLE IF NOT EXISTS attachment_chunks (
  file_id TEXT NOT NULL, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(file_id,seq)
);
