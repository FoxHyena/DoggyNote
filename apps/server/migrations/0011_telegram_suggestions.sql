-- Every pack someone sends the bot, until they add or dismiss it. telegram_pending keeps
-- the latest pack/notice for replies and older clients.
CREATE TABLE telegram_suggestions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_key TEXT NOT NULL,
  pack_name TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, pack_key)
);
INSERT OR IGNORE INTO telegram_suggestions(user_id,pack_key,pack_name,received_at)
  SELECT t.user_id,lower(t.pack_name),t.pack_name,t.updated_at FROM telegram_pending t
  WHERE t.pack_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sticker_memberships m WHERE m.user_id=t.user_id AND m.pack_name=lower(t.pack_name));
