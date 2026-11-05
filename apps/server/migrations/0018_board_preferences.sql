-- Per-person board shortcuts that follow you between devices: favourites
-- (starred when; NULL when not starred) and when you last opened a board.
CREATE TABLE board_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id TEXT NOT NULL,
  favorite_at INTEGER,
  opened_at INTEGER,
  PRIMARY KEY(user_id, board_id)
);
