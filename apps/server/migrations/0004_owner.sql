-- Private objects: anything in someone's Toy box (board "toybox:<userId>" and
-- its cards/connections) is owned by that user and never sent to anyone else.
ALTER TABLE objects ADD COLUMN owner_id TEXT;
CREATE INDEX objects_owner ON objects(owner_id);
