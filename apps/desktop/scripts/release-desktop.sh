#!/bin/sh
# Package a built DoggyNote.app for release (run by CI after `tauri build --bundles app`):
#   1. Developer ID sign, notarize and staple the app
#   2. tar.gz the stapled app + minisign signature for the Tauri updater
#   3. a signed, notarized and stapled drag-to-Applications disk image
#   4. latest.json for the updater, written to $OUT
#
# Env: VERSION, SIGN_KEYCHAIN, SIGN_IDENTITY (Developer ID cert SHA-1), APPLE_ID,
# APPLE_PASSWORD (app-specific), APPLE_TEAM_ID, TAURI_SIGNING_PRIVATE_KEY(_PASSWORD),
# optional OUT (default ./release)
set -eu
cd "$(dirname "$0")/.."
: "${VERSION:?VERSION is required}"
: "${SIGN_KEYCHAIN:?SIGN_KEYCHAIN is required}"
: "${SIGN_IDENTITY:?SIGN_IDENTITY is required}"
: "${APPLE_ID:?APPLE_ID is required}"
: "${APPLE_PASSWORD:?APPLE_PASSWORD is required}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required}"
: "${TAURI_SIGNING_PRIVATE_KEY:?TAURI_SIGNING_PRIVATE_KEY is required}"
OUT=${OUT:-release}
ARCH=$(uname -m)
[ "$ARCH" = "arm64" ] && ARCH=aarch64
B=src-tauri/target/release/bundle
APP="$B/macos/DoggyNote.app"
rm -rf "$OUT" && mkdir -p "$OUT/$VERSION"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
trap 'exit 1' HUP INT TERM

# notarytool can finish successfully even when the submission is Invalid.
# Require Accepted explicitly and print Apple's diagnostic log on rejection.
notarize() {
  archive=$1
  result="$WORK/submission.json"
  accepted=false
  if xcrun notarytool submit "$archive" \
    --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" \
    --wait --timeout 30m --output-format json > "$result"; then
    if [ "$(jq -r '.status' "$result")" = Accepted ]; then
      accepted=true
    fi
  fi
  cat "$result"
  if [ "$accepted" != true ]; then
    submission=$(jq -r '.id // empty' "$result" 2>/dev/null || true)
    if [ -n "$submission" ]; then
      xcrun notarytool log "$submission" \
        --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" || true
    fi
    echo "Notarization did not accept $archive; release stopped" >&2
    exit 1
  fi
}

# This Tauri bundle contains one executable and no embedded frameworks/helpers.
# Add inside-out signing here if the bundle gains nested executable code.
codesign --force --options runtime --timestamp --keychain "$SIGN_KEYCHAIN" --sign "$SIGN_IDENTITY" "$APP"
codesign --verify --deep --strict "$APP"
# Assert the team and bundle ID before sending any artifacts to Apple.
codesign --verify --strict -R "=anchor apple generic and certificate leaf[subject.OU] = \"$APPLE_TEAM_ID\" and identifier \"dog.doggynote.app\"" "$APP"
ditto -c -k --keepParent "$APP" "$WORK/DoggyNote.zip"
notarize "$WORK/DoggyNote.zip"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose=2 "$APP"

# Staple first: updater signatures must cover the final app, including its ticket.
tar -czf "$OUT/$VERSION/DoggyNote.app.tar.gz" -C "$B/macos" DoggyNote.app
pnpm exec tauri signer sign "$OUT/$VERSION/DoggyNote.app.tar.gz" >/dev/null
SIG=$(cat "$OUT/$VERSION/DoggyNote.app.tar.gz.sig")

DMG="DoggyNote_${VERSION}_${ARCH}.dmg"
STAGE="$WORK/dmg"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname DoggyNote -srcfolder "$STAGE" -ov -format UDZO "$OUT/$VERSION/$DMG" >/dev/null
rm -rf "$STAGE"
codesign --force --timestamp --keychain "$SIGN_KEYCHAIN" --sign "$SIGN_IDENTITY" "$OUT/$VERSION/$DMG"
codesign --verify --strict "$OUT/$VERSION/$DMG"
notarize "$OUT/$VERSION/$DMG"
xcrun stapler staple "$OUT/$VERSION/$DMG"
xcrun stapler validate "$OUT/$VERSION/$DMG"
spctl --assess --type open --context context:primary-signature --verbose=2 "$OUT/$VERSION/$DMG"

BASE=${PUBLIC_URL:-https://notepad.dog}
NOTES=${NOTES:-"DoggyNote $VERSION"}
node -e '
const [version, sig, base, dmg, notes, arch] = process.argv.slice(1)
process.stdout.write(JSON.stringify({
  version, notes, pub_date: new Date().toISOString(), dmg,
  platforms: { [`darwin-${arch}`]: { signature: sig, url: `${base}/api/desktop/files/${version}/DoggyNote.app.tar.gz` } },
}, null, 2))' "$VERSION" "$SIG" "$BASE" "$DMG" "$NOTES" "$ARCH" > "$OUT/latest.json"
echo "✓ $OUT/$VERSION/{DoggyNote.app.tar.gz,$DMG} + $OUT/latest.json"
