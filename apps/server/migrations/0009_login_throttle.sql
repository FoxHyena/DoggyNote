-- Failed sign-ins, by "user:<name>" and "ip:<address>", so guessing a password
-- is throttled. Rows older than a day are pruned on the next failure.
CREATE TABLE login_failures (key TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX login_failures_key ON login_failures(key, at);
