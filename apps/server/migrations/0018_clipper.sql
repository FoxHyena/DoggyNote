-- Clips are deliberately outside objects: older apps cannot render them before placement.
CREATE TABLE clipper_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_used_at INTEGER
);
CREATE INDEX clipper_credentials_user ON clipper_credentials(user_id);
CREATE TABLE clipper_codes (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE board_inbox (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  request_hash TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','placed','discarded')),
  placed_card_id TEXT,
  changed_at INTEGER NOT NULL
);
CREATE INDEX board_inbox_board ON board_inbox(board_id,state,created_at DESC);
CREATE INDEX board_inbox_asset ON board_inbox(asset_id);
-- Guard lifecycle checks in the same transaction as writes, including a racing burial.
CREATE TABLE inbox_write_guard (id INTEGER PRIMARY KEY CHECK(id=1), board_id TEXT NOT NULL, column_id TEXT);
CREATE TRIGGER inbox_board_valid BEFORE INSERT ON inbox_write_guard
BEGIN
  SELECT RAISE(ABORT, 'Access changed; board unavailable') WHERE NOT EXISTS (
    WITH RECURSIVE ancestors(id,data) AS (
      SELECT id,data FROM objects WHERE id=NEW.board_id AND kind='board'
      UNION
      SELECT p.id,p.data FROM objects p JOIN ancestors a ON p.id=json_extract(a.data,'$.parentId') WHERE p.kind='board'
    )
    SELECT 1 WHERE
      EXISTS(SELECT 1 FROM ancestors WHERE json_extract(data,'$.parentId') IS NULL)
      AND NOT EXISTS(SELECT 1 FROM ancestors WHERE COALESCE(json_extract(data,'$.deletedAt'),0)!=0 OR COALESCE(json_extract(data,'$.purged'),0)!=0 OR id LIKE 'toybox:%')
  );
  SELECT RAISE(ABORT, 'Access changed; column unavailable') WHERE NEW.column_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM objects WHERE id=NEW.column_id AND board_id=NEW.board_id AND json_extract(data,'$.type')='column'
      AND COALESCE(json_extract(data,'$.deletedAt'),0)=0 AND COALESCE(json_extract(data,'$.purged'),0)=0
  );
END;
-- Restrict scoped uploads to assets allocated by that connection, including retry uploads.
CREATE TABLE clipper_uploads (
  asset_id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL REFERENCES clipper_credentials(id) ON DELETE CASCADE
);
-- A token revoked between authorization and a D1 batch must not commit a clip.
CREATE TABLE clipper_write_guard (id INTEGER PRIMARY KEY CHECK(id=1), credential_id TEXT NOT NULL, checked_at INTEGER NOT NULL);
CREATE TRIGGER clipper_credential_valid BEFORE INSERT ON clipper_write_guard
BEGIN
  SELECT RAISE(ABORT, 'Clipper connection expired') WHERE NOT EXISTS (
    SELECT 1 FROM clipper_credentials WHERE id=NEW.credential_id AND revoked_at IS NULL AND expires_at>NEW.checked_at
  );
END;
