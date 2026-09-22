CREATE TABLE IF NOT EXISTS crews (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  crew_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (crew_id, member_id)
);

CREATE INDEX IF NOT EXISTS members_by_crew ON members (crew_id, updated_at DESC);
