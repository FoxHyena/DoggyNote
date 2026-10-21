-- Personal collections are intentionally outside board sync and share snapshots.
CREATE TABLE sticker_packs (
  name TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  manifest TEXT NOT NULL,
  upstream TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE sticker_memberships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_name TEXT NOT NULL REFERENCES sticker_packs(name),
  added_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, pack_name)
);
CREATE TABLE sticker_previews (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_name TEXT NOT NULL REFERENCES sticker_packs(name),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, pack_name)
);
CREATE TABLE sticker_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0,
  recent_at INTEGER,
  PRIMARY KEY(user_id, asset_id)
);
CREATE TABLE telegram_pairs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  telegram_id TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);
CREATE TABLE telegram_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  telegram_id TEXT,
  label TEXT
);
CREATE TABLE telegram_updates (id INTEGER PRIMARY KEY, received_at INTEGER NOT NULL);
CREATE TABLE telegram_pending (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pack_name TEXT,
  notice TEXT,
  updated_at INTEGER NOT NULL
);
