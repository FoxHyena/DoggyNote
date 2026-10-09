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
CI runs WebKit and Chromium as parallel jobs. Tests share that
server, so each test works on its own `freshBoard()`.

## Releases

Every merge to `main` runs `.github/workflows/release.yml`:
1. The full CI runs again.
2. The Worker and web app deploy, with migrations applied first.
3. The Mac app is built, signed with the self-signed "DoggyNote Signing" cert, and uploaded to R2 as an updater bundle, a DMG and `latest.json` (written last).

The version is `0.<minor in version.json>.<run number>`; bump `minor` by hand for big releases. Installed apps update themselves via `tauri-plugin-updater`, and browsers get a reload toast.

- The site is **https://notepad.dog** (`www.` redirects). Friends install from `https://notepad.dog/api/desktop/download`.
  The old `doggynote.oreothehyena.workers.dev` address stays up for older links and apps.
- The updater key and signing cert live in `~/.tauri/` on the maintainer's Mac and in GitHub secrets. **Back them up.**
  - Losing the updater key means installed apps can't verify updates, and everyone reinstalls once.
  - Losing the cert means one more Keychain prompt per person.

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
10. **Toy boxes are private, enforced by the server.** A `toybox:<userId>` board and everything on it carry `owner_id`. `sync.ts` sends everyone else `{ id, hidden: true }` stubs and 403s their writes. Shares refuse Toy boxes, and `assets.ts` 403s images only used there. Any new endpoint that returns objects or bytes must apply the same filter.
11. **Uploaded files are never served inline.** `GET /api/files/:id` always sends `content-disposition: attachment`, `nosniff` and a `sandbox` CSP, so an uploaded .html/.svg can't run on our origin. Access follows the image rules (rule 8). Build download links with `fileUrl()`.
12. **A deleted comment is private to its author** (the server sets `owner_id`, so others get stubs) until it's restored. Emptying Buried bones wipes its text. Comment authorship is stamped by the server (`stampComment`).
