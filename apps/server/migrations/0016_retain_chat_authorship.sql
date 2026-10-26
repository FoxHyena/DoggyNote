-- Shared exchanges outlive the account that authored them. Keep the opaque
-- author ID as immutable attribution; it grants no access without a live user.
CREATE TABLE chat_turns_retained (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chat_threads(id),
  ordinal INTEGER NOT NULL,
  author_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('claude','codex')),
  prompt TEXT NOT NULL,
  context TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('running','completed','interrupted','failed')),
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  lease_until INTEGER NOT NULL,
  event_sequence INTEGER NOT NULL DEFAULT 0,
  usage TEXT,
  error TEXT,
  finish_hash TEXT,
  UNIQUE(chat_id,ordinal)
);
INSERT INTO chat_turns_retained SELECT * FROM chat_turns;
DROP TABLE chat_turns;
ALTER TABLE chat_turns_retained RENAME TO chat_turns;
CREATE UNIQUE INDEX chat_one_active_run ON chat_turns(chat_id) WHERE status='running';
CREATE INDEX chat_turns_thread ON chat_turns(chat_id,ordinal);
