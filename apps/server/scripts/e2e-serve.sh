#!/bin/sh
# Fresh local D1 + R2 for each e2e run, with a test user, then wrangler dev.
# PORT picks the port (default 8787; Playwright uses its own).
set -e
cd "$(dirname "$0")/.."
DIR=${E2E_PERSIST_DIR:-.wrangler/e2e}
rm -rf "$DIR"
pnpm exec wrangler d1 migrations apply doggynote --local --persist-to "$DIR" > /dev/null
node --experimental-strip-types --no-warnings scripts/create-user.ts rex goodboy123 --admin --persist-to "$DIR"
node --experimental-strip-types --no-warnings scripts/create-user.ts fido fetchfetch --persist-to "$DIR"
# Represent an installation upgraded from the original shared workspace. Accounts
# created later through the API stay private; they never inherit these memberships.
pnpm exec wrangler d1 execute doggynote --local --persist-to "$DIR" --command "
INSERT INTO legacy_members (user_id) SELECT id FROM users WHERE username IN ('rex', 'fido');
UPDATE counters SET value = value + 1 WHERE name = 'seq';
INSERT INTO objects (id, kind, board_id, data, seq, updated_at, updated_by)
VALUES ('home', 'board', NULL,
  json_object('id', 'home', 'kind', 'board', 'parentId', NULL, 'title', 'Doghouse', 'icon', 'paw', 'color', 'none', 'createdAt', CAST(strftime('%s','now') AS INTEGER) * 1000),
  (SELECT value FROM counters WHERE name = 'seq'), CAST(strftime('%s','now') AS INTEGER) * 1000, NULL);
INSERT INTO board_access (board_id, owner_id, legacy) VALUES ('home', NULL, 1);
" > /dev/null
node scripts/seed-stickers.mjs "$DIR"
: > "$DIR/fixture.env"
exec pnpm exec wrangler dev --env-file "$DIR/fixture.env" --port "${PORT:-8787}" --persist-to "$DIR" --var ALLOWED_ORIGINS:tauri://localhost,http://localhost:4174 --var DEV_DIAG:1 --var MIN_CLIENT:0.0.0 --var ASSET_TOKEN_SECRET:e2e-only-not-a-real-secret --var TELEGRAM_BOT_TOKEN:fixture-only-never-sent --var TELEGRAM_BOT_USERNAME:DoggyNoteFixtureBot --var TELEGRAM_WEBHOOK_SECRET:e2e-sticker-webhook
