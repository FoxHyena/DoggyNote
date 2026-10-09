# DoggyNote build progress

Legend: [x] done + tested · [~] in progress · [ ] not started

## Phase 0 — Scaffold
- [x] pnpm monorepo, Vite + Solid, Tauri 2, Wrangler, vitest, Playwright
- [x] Light/dark theme tokens + toggle (unit + e2e)
- [x] CLAUDE.md

## Phase 1 — Canvas engine
- [x] core: model, camera math, patches + undo stack, ordering, free-spot placement
- [x] IndexedDB persistence + doc store
- [x] Canvas: pan (middle-drag / Space / two-finger), zoom at cursor, zoom menu, culling
- [x] Notes: rich text (lazy ProseMirror, markdown shortcuts), safe static render
- [x] Select (click, shift, marquee), multi-drag, resize, delete, undo/redo
- [x] Reopens on the last board you were on

## Phase 2 — Card types
- [x] Boards (nesting, icon + colour, breadcrumbs, counts, rename)
- [x] To-dos ("Good dog!" cheer, ⌥↑/⌥↓ reorder) · Columns (drag in/out/reorder)
- [x] Connectors (handle + Line tool) · Card colours · Trash ("Buried bones")
- [x] Images (paste/drop/pick, 3 sizes, EXIF stripped by re-encode) · Links (Worker OG unfurl)

## Phase 3 — Server + sync
- [x] D1 + R2, auth (PBKDF2, sessions, admin "People"), create-user script
- [x] Sync: field patches, LWW per field, offline outbox, busy-card deferral, per-field ack
- [x] Database epoch: devices re-pull if the server DB is replaced
- [x] Fixed: stale-field re-send overwrote newer edits

## Phase 4 — Sharing + desktop + deploy
- [x] View-only share links (with/without inner boards, revoke = instant 404)
- [x] Tauri app: Keychain token, CORS bearer API, links open in browser, traffic-light title bar
- [x] Real Mac app checked end to end (login, note synced, heavy board, diagnostics ⌃⌥D)
- [x] Deployed: https://doggynote.oreothehyena.workers.dev (D1 + R2 + Worker, smoke-tested)
- [x] Release Mac app + DMG built against the live server
- [ ] **You:** create your admin account (see below), then install the DMG

## Phase 5 — Polish + perf
- [x] Perf: 1,000 cards / 300 images — p95 = display frame (8.3 ms @120 Hz GPU, 16.7 ms headless), JS heap 9 MB
- [x] Zoomed-out overview drawn on one canvas (was 60 ms/frame as DOM); thumbnails in one atlas
- [x] Dog polish: paw cursor, wagging-tail loader, dog board icons, "Buried bones", "Toy box"-ready copy
- [x] ⌘K "Fetch" search across boards + cards
- [x] Full suite: 116 e2e specs × 2 browsers green (2× repeat), 54 unit tests

## Round 2 (Oct 2026)
- [x] CI on every PR: typecheck + unit + e2e (WebKit + Chromium) + informational perf (#1)
- [x] Private images: session, desktop asset token, or share link scoped to shared boards (#2)
- [x] Connectors snap to side midpoints; curved; facing sides when unpinned (#5)
- [x] Markdown notes, Obsidian-style live preview (CodeMirror 6), legacy notes migrated (#4)
- [~] Release pipeline: auto deploy + signed, self-updating Mac app (#6). **Needs your `CLOUDFLARE_API_TOKEN` secret**
- [~] 640 px image tier (#7). Decoded images at 100%: 94 → 34 MB

## Round 3 (in progress)
- [x] Sharp zoom in the desktop app (2D world transform)
- [x] Dot grid + snap-to-grid toggle (⌘'), glow + haptic tick on desktop
- [ ] Memory pass (Mac app ≤150 MB)
- [ ] Toy box (personal, **server-enforced privacy**) + global quick capture
- [ ] Comment threads on cards
- [ ] File uploads
- [ ] Export board as PNG
- [ ] Milanote import (needs a sample export)

## Still open
1. [ ] Memory: busy boards still ~183–202 MB in the Mac app (target 150). The rest is WebKit graphics surfaces + JS heap; next lever is fewer GPU layers
2. [ ] Intel Mac build (CI builds Apple silicon only); a universal build if a friend needs it
3. [ ] v0.2 backlog: Toy box (unsorted + quick-capture hotkey), comments, file uploads, PNG export, Milanote import
