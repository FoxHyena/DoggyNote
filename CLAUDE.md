# DoggyNote

A self-hosted, dog-themed infinite-canvas board app (a Milanote replacement) for 5–10 users.
It runs as a Tauri desktop app on macOS. View-only board links open in any browser.

The `~/Projects/CLAUDE.md` file above this repo is for the ClubKnot scheduler. **It does not apply here.**

Plan: `~/.claude/plans/hey-there-i-d-like-curious-shore.md`. Phases 0–5. MVP feature tiers are listed there.

## Layout

```
apps/web/        SolidJS + Vite canvas app (editor + read-only share viewer). e2e in apps/web/e2e
apps/desktop/    Tauri 2 shell around apps/web (src-tauri/)
apps/server/     Cloudflare Worker (Hono): auth, sync, assets (R2), shares, unfurl. D1 migrations in migrations/
packages/core/   Pure TS: geometry + connector anchors, camera, patches/undo, markdown parsing. No DOM
packages/theme/  Colour tokens (light + dark), theme mode logic, dog-themed copy
```

## Commands

```bash
pnpm dev                              # web app on :5173
pnpm test                             # vitest, all packages
pnpm test:e2e                         # Playwright, WebKit + Chromium
pnpm --filter server dev              # Worker on :8787
pnpm --filter desktop dev             # Tauri window against the dev server
pnpm --filter desktop build:local      # DoggyNote.app against a local Worker (test build, no Keychain)
pnpm --filter desktop build            # release .app + .dmg (set VITE_API_BASE to the deployed URL)
pnpm --filter server e2e:serve         # fresh local D1/R2 with users rex/goodboy123 (admin) + fido
pnpm --filter server deploy:all        # Cloudflare: D1, R2, migrations, web build, Worker
pnpm --filter server create-user <name> <password> [--admin] [--remote]
PERF_HEADED=1 pnpm --filter web exec playwright test perf --project=chromium   # GPU perf check
```

e2e runs against the production build plus a real Worker on a fresh local D1, on ports of its own
(web 5175, Worker 8788; `e2e/ports.ts`), so a dev or hand-started Worker on 8787 is never reused.
Set `E2E_PORT_OFFSET=<n>` to shift every e2e port when another checkout is running its suite.
CI runs WebKit and Chromium as parallel jobs. Tests share that
server, so each test works on its own `freshBoard()`.

## Releases

After merging to `main`, manually run `.github/workflows/release.yml` on main as a separate release action:
1. The full CI runs again.
2. The website and Worker deploy as soon as CI passes, with migrations applied first and `APP_VERSION` set to the new version (so browsers get their reload toast right away).
3. Meanwhile the Mac app is built, then signed with a Developer ID Application certificate with hardened runtime and a secure timestamp. Apple must accept notarization, stapling and Gatekeeper checks for both the app and DMG before its updater bundle, DMG and versioned `desktop/<version>/latest.json` (written last) are staged in R2. The updater archive is created from the stapled app before receiving its Tauri signature.
4. Installed apps are pointed at the new version only after its notarized build is staged: the Worker serves `desktop/<APP_VERSION>/latest.json` once it exists, and the last published `desktop/latest.json` until then. A failed or slow Mac build never holds up the website and never strands old apps; the old Worker never advertises a new desktop build.
5. After both, the fallback `desktop/latest.json` and the GitHub release are published.

A `MIN_CLIENT` bump makes the deploy wait for the Mac build. The `guard` job (`apps/server/scripts/min-client-guard.sh`) compares `MIN_CLIENT` in `wrangler.toml` with the live `/api/version`; if they differ, or the live value can't be read, the Worker deploys only after the compatible build is staged, so apps sent to "update required" can fetch it.

The version is `0.<minor in version.json>.<run number>`; bump `minor` by hand for big releases. Installed apps update themselves via `tauri-plugin-updater`, and browsers get a reload toast.

- The site is **https://notepad.dog** (`www.` redirects). Friends install from `https://notepad.dog/api/desktop/download`.
  The old `doggynote.oreothehyena.workers.dev` address stays up for older links and apps.
- The updater key and signing cert live in `~/.tauri/` on the maintainer's Mac and in GitHub secrets. **Back them up.**
  - Losing the updater key means installed apps can't verify updates, and everyone reinstalls once.
  - Losing the cert means one more Keychain prompt per person.
- Release signing uses GitHub Actions secrets `MACOS_CERT_P12` (base64 Developer ID Application certificate and private key) and `MACOS_CERT_PASSWORD` (export password). Notarization uses `APPLE_ID`, `APPLE_PASSWORD` (an Apple app-specific password) and `APPLE_TEAM_ID`. These are scoped to the steps that need them; the certificate is imported only after the build. Keep the existing Tauri updater key when changing Apple certificates. Moving from the old self-signed certificate may require users to approve Keychain access or sign in once more.

**API compatibility:** the web app and Worker deploy together, but desktop apps lag behind. API changes must be additive. A breaking change has to bump `MIN_CLIENT` in `apps/server/wrangler.toml`, which sends older apps to an "update required" screen.

## Rules

1. **Every feature gets an end-to-end test as it's built.** Add a Playwright spec in `apps/web/e2e/` that drives real input on WebKit and Chromium. Then check the feature by hand in the running app. A phase isn't done until the full e2e suite and the unit tests are green.
2. **Colours come only from `@doggynote/theme`, through CSS variables (`var(--dn-*)`).** Never hard-code a hex value in a component.
   - Every new colour needs a light and a dark value.
   - Every new colour must pass `theme.test.ts`: text needs 4.5:1 contrast, the selection outline needs 3:1.
3. **Performance is a feature.** The perf spec enforces it.
   - Pan and zoom only change the transform on the world div.
   - Cards are positioned with `left`/`top`, never a per-card `transform`. A thousand transforms made the browser re-layerize every card on every frame (61 ms vs 9 ms).
   - Off-screen cards are not mounted.
   - Below 35% zoom, cards aren't DOM at all. `LodLayer` draws them on one canvas, and image thumbnails are packed into one atlas. Hit-testing is geometric.
   - Only the card being edited mounts an editor.
4. **`packages/core` stays DOM-free**, so it can be shared with the Worker and unit-tested in Node.
5. **Dog-themed names live in `COPY`** (`packages/theme/src/copy.ts`). Never inline these strings.
6. Prefer boring solutions. One maintainer, a handful of users.
7. **Sync is per field.** Only acknowledge fields that didn't change while a push was in flight (`ackOutbox`). Re-sending a stale field overwrites someone else's newer edit.
8. **Images need a credential.** That's a session, a `?t=` asset token (desktop app) or `?share=` (viewer only, for images on shared boards). Always build image URLs with `assetUrl()` in `state/api.ts`.
9. **Notes are markdown** (`content.md`). `packages/core/src/markdown.ts` parses it into the sanitized tree that `RichText` draws with `createElement` only. Never render note HTML with `innerHTML`. The editor is CodeMirror 6 with a live preview (`editor/codemirror.ts`), lazy-loaded.
10. **Inboxes are private, enforced by the server.** An Inbox keeps its internal `toybox:<userId>` board ID; it and everything on it carry `owner_id`. `sync.ts` sends everyone else `{ id, hidden: true }` stubs and 403s their writes. Shares refuse Inboxes, and `assets.ts` 403s images only used there. Any new endpoint that returns objects or bytes must apply the same filter.
11. **Uploaded files are never served inline.** `GET /api/files/:id` always sends `content-disposition: attachment`, `nosniff` and a `sandbox` CSP, so an uploaded .html/.svg can't run on our origin. Access follows the image rules (rule 8). Build download links with `fileUrl()`.
12. **Phones and touchscreens are first-class.** Touch input takes its own path in `canvas/Canvas.tsx` (per event, by `pointerType`): one finger pans, a selected card drags, long-press lifts, two fingers pinch. Mouse and pen behave as on desktop.
   - The phone layout is `phone()` in `state/device.ts` (max-width 599px, or a phone on its side); its CSS lives in `ui/mobile.css`, loaded last. Touch-only CSS keys off `html[data-input='touch']`.
   - Never change text size or padding *inside* cards for touch: heights are measured and synced. Enlarge targets outside the card or with geometric hit-tests.
   - Focus that should raise the iOS keyboard must happen synchronously in the tap (no timers, no awaited imports before `focus()`).
   - Every touch feature gets a spec in `e2e/mobile-*.spec.ts` (iPhone + Pixel projects) or `tablet-*.spec.ts`; `e2e/touch.ts` drives real taps and multi-finger gestures.
13. **A deleted comment is private to its author** (the server sets `owner_id`, so others get stubs) until it's restored. Emptying Buried bones wipes its text. Comment authorship is stamped by the server (`stampComment`).
14. **Admins manage accounts, not other people's boards.** In `loadAccess`, admins own only *ownerless* boards (legacy shared space, boards of removed accounts). Anything else needs a grant, as for anyone. Sign-ins are throttled (`login_failures`). Synced field values are unchecked, so anything rendered from them must survive the wrong type: cards render inside an `ErrorBoundary`, and colours go through `cardColor()`. Review record: `docs/security-review-2026-10.md`.
15. **Edit in place, not in pop-up dialogs.** Double-clicking a card edits it right there (note text, image caption, sketch), with no separate "Edit" button and no dialog.
    - Show a control only when it can do something. For example, the align icons appear only when 2+ items are selected.
    - Prefer standard icons with tooltips over text buttons, dropdowns or groups of buttons: align, theme toggle, Draw vs Sketch.
    - Keep the selection bar on one line, and put rarely used actions in an overflow menu.
    - The note editor must space and style text the same as the rendered note.

## Delivery flow

One batch → one agent, one branch, one PR → CI green (`pnpm test` + `pnpm test:e2e`) → a preview for the user → a 10-minute manual check → merge.
- CI is the test gate. Don't build parallel QA campaigns, evidence fingerprints, leases or heartbeats.
- UI PRs carry dark/light, desktop/phone screenshots in the PR body (`docs/qa/<feature>/`). Don't run separate per-feature approval rounds or native computer-use runs unless asked.
- Write status updates in plain sentences.
