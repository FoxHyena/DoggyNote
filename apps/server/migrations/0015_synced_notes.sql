-- Synced copies of a note share a syncId (packages/core/src/synced.ts).
CREATE INDEX objects_sync_id ON objects(json_extract(data, '$.syncId')) WHERE json_extract(data, '$.syncId') IS NOT NULL;
