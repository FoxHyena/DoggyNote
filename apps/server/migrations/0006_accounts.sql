-- Only hashes of invitation/recovery secrets are retained.
CREATE TABLE account_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('invite', 'recovery')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  used_at INTEGER,
  redeemed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  redemption_id TEXT
);
CREATE INDEX account_links_created ON account_links(created_at);
CREATE TRIGGER protect_final_admin_delete BEFORE DELETE ON users
WHEN OLD.is_admin = 1 AND (SELECT COUNT(*) FROM users WHERE is_admin = 1) <= 1
BEGIN SELECT RAISE(ABORT, 'Cannot remove the final admin'); END;
CREATE TRIGGER protect_final_admin_update BEFORE UPDATE OF is_admin ON users
WHEN OLD.is_admin = 1 AND NEW.is_admin = 0 AND (SELECT COUNT(*) FROM users WHERE is_admin = 1) <= 1
BEGIN SELECT RAISE(ABORT, 'Cannot remove the final admin'); END;
