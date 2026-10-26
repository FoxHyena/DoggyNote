#!/bin/sh
# Decide whether a release's Worker deploy must wait for the Mac build.
#
# Normally the Worker and web app deploy as soon as CI passes, and installed apps
# only see the new version once its notarized bundle is staged in R2 (the
# Worker serves desktop/$APP_VERSION/latest.json only after it exists).
#
# A MIN_CLIENT change is different: the new Worker sends older apps to "update
# required", so the compatible bundle must already be staged when it goes live.
# Releases are manual and can bundle several merges, so compare against what is
# live (GET /api/version), not the previous commit.
#
# Prints "wait_for_desktop=true|false" (for $GITHUB_OUTPUT). If the live value
# can't be read, it waits: the slow, old ordering is always safe.
# Env: optional PUBLIC_URL (default https://notepad.dog), WRANGLER_TOML.
set -eu
cd "$(dirname "$0")/.."
URL=${PUBLIC_URL:-https://notepad.dog}
TOML=${WRANGLER_TOML:-wrangler.toml}
VERSION_RE='^[0-9]+\.[0-9]+\.[0-9]+$'

wanted=$(sed -n 's/^MIN_CLIENT[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$TOML")
if [ "$(printf '%s\n' "$wanted" | grep -c .)" != 1 ] || ! printf '%s' "$wanted" | grep -Eq "$VERSION_RE"; then
  echo "Could not read one MIN_CLIENT x.y.z from $TOML" >&2
  exit 1
fi

live=$(curl -fsS --max-time 20 --retry 3 --retry-all-errors "$URL/api/version" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const m=JSON.parse(s).minClient;process.stdout.write(typeof m==="string"?m:"")}catch{}})' \
  || true)

if ! printf '%s' "$live" | grep -Eq "$VERSION_RE"; then
  echo "Could not read the live MIN_CLIENT from $URL/api/version; waiting for the Mac build to be safe" >&2
  echo "wait_for_desktop=true"
elif [ "$live" != "$wanted" ]; then
  echo "MIN_CLIENT changes from $live to $wanted; the Worker deploys after the Mac build is staged" >&2
  echo "wait_for_desktop=true"
else
  echo "MIN_CLIENT stays $wanted; the Worker deploys without waiting for the Mac build" >&2
  echo "wait_for_desktop=false"
fi
