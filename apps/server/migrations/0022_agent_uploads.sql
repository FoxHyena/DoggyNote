-- Images an agent connection uploaded itself. Its proposals may place these
-- (and only these) new assets, so an agent can't name someone else's upload.
CREATE TABLE agent_uploads (
  asset_id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL REFERENCES agent_credentials(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX agent_uploads_credential ON agent_uploads(credential_id, created_at);
