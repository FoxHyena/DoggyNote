-- Agent credentials are independent of account sessions and only authorize reads/proposals.
CREATE TABLE agent_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK(mode IN ('read','propose')),
  board_ids TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_used_at INTEGER
);
CREATE INDEX agent_credentials_user ON agent_credentials(user_id);
CREATE TABLE agent_proposals (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL REFERENCES agent_credentials(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applying','applied','rejected','reversing','reversed')),
  changes TEXT NOT NULL,
  applied_revisions TEXT,
  created_at INTEGER NOT NULL,
  applied_at INTEGER,
  UNIQUE(credential_id,request_key)
);
CREATE INDEX agent_proposals_user ON agent_proposals(user_id,created_at);
