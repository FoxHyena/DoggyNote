-- How far each person has read each comment thread (keyed by the card), in
-- server time. The row '*' is when they first used unread dots: older comments
-- count as read, so the backlog doesn't light up all at once (apps/server/src/seen.ts).
CREATE TABLE seen (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_id TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, object_id)
) WITHOUT ROWID;
