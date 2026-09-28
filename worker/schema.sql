CREATE TABLE IF NOT EXISTS crews (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  admin_token_hash TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  crew_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  passcode_hash TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  name_key TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (crew_id, member_id)
);

CREATE INDEX IF NOT EXISTS members_by_crew ON members (crew_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS members_by_name ON members (crew_id, name_key);

-- Upgrading a database made before crews had an admin or members a passcode.
-- Each of these fails harmlessly with "duplicate column name" if already run.
ALTER TABLE crews ADD COLUMN admin_token_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN passcode_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN name_key TEXT NOT NULL DEFAULT '';
