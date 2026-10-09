#!/bin/sh
# Fresh local D1 + R2 for each e2e run, with a test user, then wrangler dev.
# PORT picks the port (default 8787; Playwright uses its own).
set -e
cd "$(dirname "$0")/.."
DIR=.wrangler/e2e
rm -rf "$DIR"
pnpm exec wrangler d1 migrations apply doggynote --local --persist-to "$DIR" > /dev/null
node --experimental-strip-types --no-warnings scripts/create-user.ts rex goodboy123 --admin --persist-to "$DIR"
node --experimental-strip-types --no-warnings scripts/create-user.ts fido fetchfetch --persist-to "$DIR"
exec pnpm exec wrangler dev --port "${PORT:-8787}" --persist-to "$DIR" --var ALLOWED_ORIGINS:tauri://localhost,http://localhost:4174 --var DEV_DIAG:1 --var ASSET_TOKEN_SECRET:e2e-only-not-a-real-secret
