# Security review — October 2026

Scope:
- the Worker (`apps/server/src`, all migrations)
- the web client (`apps/web/src`, `packages/core`, `packages/theme`)
- the Tauri shell (`apps/desktop/src-tauri`)
- CI and release workflows, scripts, secrets, dependencies
- the MCP connector (`apps/mcp`)

Result: no XSS, SQL injection or authentication bypass found. The High item and the Medium items below are fixed in this change. The Low items are accepted for now and listed with their reasons.

## Roles and access after this change

| Who | Can read | Can edit | Can manage sharing |
| --- | --- | --- | --- |
| Board owner | their boards and everything nested under them | same | their boards |
| Member (username grant or accepted edit link) | the granted board (and children, if included) | if granted `edit` | no |
| Admin | ownerless boards (legacy shared space, boards left by removed accounts), plus anything shared with them | same | ownerless boards |
| Anyone with a view link | the linked board (and nested boards) while its creator still looks after it | no | no |
| Agent connection | the chosen boards ∩ its user's live access | proposals only, approved by the user | no |
| Everyone except the owner | never another person's Inbox, or a deleted comment | — | — |

Admins manage accounts: invitations, recovery links, sessions and removal. They no longer see or manage other people's private boards (including each person's Doghouse) unless those are shared with them.

## Findings

### High — fixed

**H1. No sign-in throttling.** `POST /api/auth/login` allowed unlimited password guesses on the public site.
- Now: 10 failures per username or 50 per address in 15 minutes returns `429`, and the form says why. The check runs before the password, so a correct guess during a lockout still fails.
- Code: `apps/server/src/auth.ts`, migration `0009_login_throttle.sql`.
- Tests: `auth.integration.test.ts`, `e2e/auth-throttle.spec.ts`.
- Accepted trade-off: someone who knows a username can lock it out for 15 minutes.

### Medium — fixed

**M1. Admins could read, edit and share every non-Inbox board.** The UI promises "Your boards start private".
- Now: admins act only on ownerless boards; see the table above.
- Code: `access.ts`.
- Tests: `access.test.ts`, `e2e/access.spec.ts`.

**M2. Old view links (`scope_version` 0) followed board cards into any board the link's creator could read.** That includes a board someone had shared with them view-only, so an editor could publish such a board through an old link.
- Now: old links follow board cards only into boards the creator looks after, or boards nested under the link's root.
- Code: `shares.ts`. Test: `access.test.ts`.

**M3. View links kept working after their creator lost the right to manage the root.** Edit links already checked this.
- Now: view links check it too. Legacy shared-space members still count for legacy boards.
- Code: `shares.ts`.

**M4. A malformed synced object could break a board for everyone who opened it.** Examples: `icon: 'valueOf'`, a non-string file name, `content: null`. Sync stores field values unchecked.
- Now:
  - each card renders inside an error boundary
  - the zoomed-out canvas, ⌘K search and the Buried bones / Inbox labels skip a malformed card instead of failing. Search walks every board, so one bad card used to break it for everyone.
  - board icons, titles, file kinds and markdown input are type-checked
  - prototype-name IDs (`__proto__`, `constructor`, …) are refused by sync and by agent proposals
- Code: `CardView.tsx`, `LodLayer.tsx`, `Fetch.tsx`, `TrashPanel.tsx`, `icons.tsx`, `copy.ts`, `files.ts`, `markdown.ts`, `sync.ts`, `agent.ts`.
- Test: `e2e/malformed.spec.ts`.

**M5. Colours were pasted into CSS.** A crafted `color` could set a background image (a tracking pixel) on a card for every viewer.
- Now: only `CARD_COLORS` are used (`cardColor()` in `@doggynote/theme`).

**M6. Release secrets were set for the whole job.** `CLOUDFLARE_API_TOKEN` was readable by every dependency install, Rust build script and third-party action in the release jobs. The signing keychain was unlocked before the build.
- Now:
  - the token is set only on the wrangler steps
  - the keychain is imported after the build
  - actions are pinned to commit SHAs
  - release jobs run only from `main`
  - CI runs with `contents: read`

### Low — hardened

- `applyProposal` builds guard SQL with IDs pasted into the query. IDs are validated on the way in and are now re-checked right before (`agents.ts`).
- `.gitignore` now covers `.env*`, `*.p12`, `*.pem`, `*.key`.
- `deploy.sh` generates `ASSET_TOKEN_SECRET` if it's missing; the README documents it.

### Low — accepted (not fixed)

- Any board owner can check whether a username exists (`POST /boards/:id/members`).
- No per-user upload quota. Everyone with an account is trusted.
- Every image on a public link runs `resolveShare`, which reads the whole objects table. Fine at this scale.
- `GET /api/sync` sends `{ id, hidden }` stubs for unreadable objects (needed for eviction). This reveals object IDs and counts.
- Link previews: `unfurl`/`proxy-image` follow redirects with no host blocklist. Workers can't reach private networks, and only signed-in users can call them.
- Link-card preview images load straight from third-party hosts. They see the viewer's IP, but no Referer is sent.
- The desktop CSP allows `img-src http: https:` and a broad `connect-src`.
- Desktop file downloads open a `?t=` URL in the system browser. The token stays in its history; it is valid for up to 2 days and only while that session lasts.
- `/share?url=…` adds a card to your own Inbox without asking.
- `create-user` takes the password as an argument, so it lands in shell history.
- The Mac app is self-signed and not notarized. Updates are still verified by the updater signature.

## Checked and sound

- **Sessions:** 256-bit random tokens, stored as SHA-256 only. The cookie is HttpOnly, Secure and SameSite=Lax, and each request is checked against D1, so revocation is immediate.
- **CSRF:** POSTs must be JSON, and PUT/DELETE need a CORS preflight. CORS is an allowlist with no credentials.
- **Passwords:** PBKDF2-SHA256 with a constant-time compare, and a dummy hash for unknown usernames.
- **Invite and recovery links:** stored as hashes, single-use, redeemed atomically. Triggers prevent removing the final admin.
- **Inbox privacy:** `owner_id` plus the toybox walk in `loadAccess`. Applied in sync, shares, assets and agents, and it holds against admins too.
- **Sync write authorization (`deniedChanges`):**
  - no kind changes, no ownership fields, no taking over home or toybox IDs
  - reparenting needs manage rights; cycles are refused
  - column, comment and connection consistency; asset theft blocked
  - the access write guard rejects writes that race a permission change
- **Files:** `attachment` + `nosniff` + sandbox CSP. Images: allowlisted types + `nosniff`. `proxy-image` refuses SVG.
- **Web client:** no `innerHTML`/`eval`. Markdown has raw HTML off, and `safeHref` allows only `http`, `https` and `mailto`. The CSP has `script-src 'self'` and `frame-ancestors 'none'`. `Referrer-Policy` is set and external links use `noreferrer`.
- **Desktop:**
  - no remote IPC, no `withGlobalTauri`, no devtools in release builds
  - the opener is limited to `http`, `https` and `mailto`
  - the token is kept in the Keychain
  - the updater uses a minisign key over HTTPS
- **Test accounts** (rex, fido) are only ever created on a local D1.
