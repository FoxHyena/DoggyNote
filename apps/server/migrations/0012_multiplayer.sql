-- State and the rendered Markdown projection are changed in the same D1 batch.
CREATE TABLE note_states (id TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE, state TEXT NOT NULL, revision INTEGER NOT NULL);
CREATE TABLE note_write_guard (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, object_seq INTEGER NOT NULL);
CREATE TRIGGER note_revision_valid BEFORE INSERT ON note_write_guard BEGIN
  SELECT RAISE(ABORT, 'Note changed; retry') WHERE NEW.revision != COALESCE((SELECT revision FROM note_states WHERE id=NEW.id),0);
  SELECT RAISE(ABORT, 'Note changed; retry') WHERE NEW.object_seq != COALESCE((SELECT seq FROM objects WHERE id=NEW.id),0);
END;
