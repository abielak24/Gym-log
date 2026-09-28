-- Accounts are the front door: everything else identifies you by the session
-- token one of these issues.

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  handle_key TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL,
  -- Public by design: a phone needs it before it can derive anything.
  salt TEXT NOT NULL,
  -- A hash of the key the phone derived. The password never arrives here.
  key_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_by_account ON sessions (account_id);

-- Wrong guesses, per handle, so a password cannot be worked through.
CREATE TABLE IF NOT EXISTS attempts (
  handle_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Values the server keeps to itself. Currently one: the secret behind the
-- invented salts handed out for handles nobody has.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crews (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  owner_account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  crew_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  summary TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (crew_id, account_id)
);

CREATE INDEX IF NOT EXISTS members_by_crew ON members (crew_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS members_by_name ON members (crew_id, name_key);

-- Everybody's log, one row per record, so two devices merge instead of
-- overwriting each other. `deleted` rows are tombstones: they carry no body
-- and exist so a workout deleted on one phone does not come back from the
-- other.
CREATE TABLE IF NOT EXISTS log (
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  PRIMARY KEY (account_id, kind, id)
);

CREATE INDEX IF NOT EXISTS log_by_account ON log (account_id, updated_at);
