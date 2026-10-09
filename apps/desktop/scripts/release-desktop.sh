#!/bin/sh
# Package a built DoggyNote.app for release (run by CI after `tauri build --bundles app`):
#   1. sign it with the self-signed "DoggyNote Signing" cert, if a keychain with it is unlocked
#      (a stable signature is what keeps the Keychain "Always Allow" across updates)
#   2. tar.gz + minisign signature for the Tauri updater
#   3. a drag-to-Applications disk image
#   4. latest.json for the updater, written to $OUT
#
# Env: VERSION, TAURI_SIGNING_PRIVATE_KEY(_PASSWORD), optional SIGN_KEYCHAIN + SIGN_IDENTITY
# (cert SHA-1; defaults to the name), OUT (default ./release)
set -e
cd "$(dirname "$0")/.."
: "${VERSION:?VERSION is required}"
OUT=${OUT:-release}
ARCH=$(uname -m)
[ "$ARCH" = "arm64" ] && ARCH=aarch64
B=src-tauri/target/release/bundle
APP="$B/macos/DoggyNote.app"
rm -rf "$OUT" && mkdir -p "$OUT/$VERSION"

if [ -n "$SIGN_KEYCHAIN" ]; then
  codesign --force --deep --keychain "$SIGN_KEYCHAIN" --sign "${SIGN_IDENTITY:-DoggyNote Signing}" "$APP"
  codesign --verify --deep "$APP"
  echo "✓ signed: $(codesign -dr - "$APP" 2>&1 | tail -1)"
fi

tar -czf "$OUT/$VERSION/DoggyNote.app.tar.gz" -C "$B/macos" DoggyNote.app
pnpm exec tauri signer sign "$OUT/$VERSION/DoggyNote.app.tar.gz" >/dev/null
SIG=$(cat "$OUT/$VERSION/DoggyNote.app.tar.gz.sig")

DMG="DoggyNote_${VERSION}_${ARCH}.dmg"
STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname DoggyNote -srcfolder "$STAGE" -ov -format UDZO "$OUT/$VERSION/$DMG" >/dev/null
rm -rf "$STAGE"

BASE=${PUBLIC_URL:-https://notepad.dog}
NOTES=${NOTES:-"DoggyNote $VERSION"}
node -e '
const [version, sig, base, dmg, notes, arch] = process.argv.slice(1)
process.stdout.write(JSON.stringify({
  version, notes, pub_date: new Date().toISOString(), dmg,
  platforms: { [`darwin-${arch}`]: { signature: sig, url: `${base}/api/desktop/files/${version}/DoggyNote.app.tar.gz` } },
}, null, 2))' "$VERSION" "$SIG" "$BASE" "$DMG" "$NOTES" "$ARCH" > "$OUT/latest.json"
echo "✓ $OUT/$VERSION/{DoggyNote.app.tar.gz,$DMG} + $OUT/latest.json"
