#!/bin/sh
# Plain drag-to-Applications disk image. (Tauri's own DMG step scripts Finder,
# which fails without extra permissions; this needs only hdiutil.)
set -e
cd "$(dirname "$0")/.."
B=src-tauri/target/release/bundle
VERSION=$(node -p 'require("./src-tauri/tauri.conf.json").version')
rm -rf "$B/dmg-src" && mkdir -p "$B/dmg-src"
cp -R "$B/macos/DoggyNote.app" "$B/dmg-src/"
ln -s /Applications "$B/dmg-src/Applications"
hdiutil create -volname DoggyNote -srcfolder "$B/dmg-src" -ov -format UDZO "$B/DoggyNote_${VERSION}_$(uname -m).dmg" >/dev/null
rm -rf "$B/dmg-src"
echo "✓ $B/DoggyNote_${VERSION}_$(uname -m).dmg"
