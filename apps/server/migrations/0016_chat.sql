-- Conversation content is never accepted by ordinary object sync or public shares.
CREATE TABLE chat_threads (
  id TEXT PRIMARY KEY REFERENCES objects(id),
  revision INTEGER NOT NULL DEFAULT 0,
  inherited TEXT NOT NULL DEFAULT '[]',
  parent TEXT
);
CREATE TABLE chat_turns (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chat_threads(id),
  ordinal INTEGER NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
CREATE UNIQUE INDEX chat_one_active_run ON chat_turns(chat_id) WHERE status='running';
CREATE INDEX chat_turns_thread ON chat_turns(chat_id,ordinal);
-- App-origin proposals have no issued machine token and only create a task list.
ALTER TABLE agent_credentials ADD COLUMN origin TEXT;
CREATE TABLE chat_outputs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chat_threads(id),
  request_hash TEXT NOT NULL,
  proposal_id TEXT NOT NULL REFERENCES agent_proposals(id)
);
