-- Preserve old public links' reference traversal. New links use canonical
-- parent ancestry so a reference cannot publish another private root.
ALTER TABLE shares ADD COLUMN scope_version INTEGER NOT NULL DEFAULT 0;
