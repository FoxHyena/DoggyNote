-- DoggyNote schema. One shared workspace; every synced thing is a JSON object.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_hash     TEXT NOT NULL,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

-- Only a SHA-256 of the session token is stored; a leaked table can't log anyone in.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Boards, cards and connections. `data` is the object's JSON; `seq` is a
-- global change counter clients pull from.
CREATE TABLE objects (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  board_id    TEXT,
  data        TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT
);
CREATE INDEX objects_seq ON objects(seq);
CREATE INDEX objects_board ON objects(board_id);

CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO counters (name, value) VALUES ('seq', 0);

-- Image sizes stored in R2 under "<id>/<size>".
CREATE TABLE assets (
  id          TEXT NOT NULL,
  size        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  created_by  TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (id, size)
);

CREATE TABLE shares (
  token            TEXT PRIMARY KEY,
  board_id         TEXT NOT NULL,
  include_children INTEGER NOT NULL DEFAULT 1,
  created_by       TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  revoked_at       INTEGER
);
CREATE INDEX shares_board ON shares(board_id);
