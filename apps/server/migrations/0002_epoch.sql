-- Identifies this database. Clients cache their sync cursor per epoch, so a
-- rebuilt or replaced database makes them re-pull instead of silently missing data.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO meta (key, value) VALUES ('epoch', lower(hex(randomblob(8))));
