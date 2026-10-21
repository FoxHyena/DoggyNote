-- loadAccess lists every board on each sync poll; without this it scans all objects.
CREATE INDEX objects_kind ON objects(kind);
