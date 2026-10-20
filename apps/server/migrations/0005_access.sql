-- Existing boards stay collectively shared with precisely the accounts present
-- at migration time. New accounts never inherit this membership.
CREATE TABLE legacy_members (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE);
INSERT INTO legacy_members SELECT id FROM users;
CREATE TABLE board_access (
  board_id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  legacy INTEGER NOT NULL DEFAULT 0
);
INSERT INTO board_access (board_id, owner_id, legacy) SELECT id, NULL, 1 FROM objects WHERE kind = 'board' AND id NOT LIKE 'toybox:%';
CREATE INDEX board_access_owner ON board_access(owner_id);
CREATE TABLE board_grants (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('view', 'edit')),
  source_token TEXT,
  include_children INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX board_grants_user ON board_grants(user_id, revoked_at);
CREATE INDEX board_grants_board ON board_grants(board_id, revoked_at);
ALTER TABLE shares ADD COLUMN permission TEXT NOT NULL DEFAULT 'view';
ALTER TABLE shares ADD COLUMN expires_at INTEGER;
ALTER TABLE shares ADD COLUMN allow_signup INTEGER NOT NULL DEFAULT 0;
INSERT INTO counters (name, value) VALUES ('access_revision', 1);
-- Atomic redemption guard: a revocation racing signup rolls back account and
-- grant together, instead of silently creating an uninvited account.
CREATE TRIGGER board_grant_source_valid BEFORE INSERT ON board_grants
WHEN NEW.source_token IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Board invitation is unavailable') WHERE NOT EXISTS (
    SELECT 1 FROM shares WHERE token=NEW.source_token AND board_id=NEW.board_id
      AND permission='edit' AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
  );
END;
-- Put this guard first in a mutation batch, so a concurrent permission change
-- cannot slip between authorization reads and committed writes.
CREATE TABLE access_write_guard (id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL);
CREATE TRIGGER access_revision_valid BEFORE INSERT ON access_write_guard
BEGIN
  SELECT RAISE(ABORT, 'Access changed; refresh and retry') WHERE NEW.revision != (SELECT value FROM counters WHERE name='access_revision');
END;
