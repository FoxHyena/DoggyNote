# DoggyNote multiplayer verification

Local verification only; no deployment or native desktop build. **Final result: 629 browser tests passed, seven expected skips; 227 unit/server tests passed; typecheck and Worker dry build passed.** The final whole-suite result is recorded in `full-suite-verified.log`. The real Worker uses fresh local D1/R2 and the same production web bundles, plus the browser-served cross-origin desktop configuration.

## Commands and evidence

| Check | Command / evidence |
|---|---|
| Unit/server regression | `pnpm test` — `unit.log` |
| Typecheck | `pnpm typecheck` — `typecheck.log` |
| Full browser suite | `E2E_PORT_OFFSET=40 pnpm --filter web exec playwright test --workers=2 --grep-invert '@perf'` — `full-suite-verified.log` |
| Targeted persistence/lifecycle | `playwright test multiplayer.spec.ts multiplayer-lifecycle.spec.ts --workers=2 --grep 'reload\|offline\|background tabs'` — `persistence-lifecycle.log` |
| GPU large-board baseline | `PERF_HEADED=1 playwright test perf.spec.ts --project=chromium --workers=1` — `perf-baseline.log` |
| Ten authenticated identities | Same command with `MULTIPLAYER_PERF=1` — `perf-ten-people.log` |
| Worker build without deployment | `wrangler deploy --dry-run --outdir /tmp/doggynote-worker-build` — `worker-build.log` |
| Rendered review | `MULTIPLAYER_SHOTS=1 MULTIPLAYER_ROUND=round-2 playwright test multiplayer-visual.spec.ts --project=webkit --project=chromium` — `confirmation.log`, `round-2/` |

The full run exercises Chromium, WebKit, iPhone 15 Pro, Pixel 7 and iPad projects. The seven expected skips are WebKit OS clipboard, native visibility and native IME; two opt-in collaboration screenshot cases (run separately for the rendered review); and two opt-in README screenshot cases. Native IME is driven through Chromium CDP; WebKit covers Unicode input, formatting, carets and concurrent edits. Native visibility uses a temporary Chrome profile with Playwright's forced-focus override disabled, real same-window tabs, and a real renderer crash. CI runs under Xvfb for that browser test. No document visibility properties are mocked.

## Behavior coverage

`multiplayer.spec.ts` uses separately authenticated browser contexts and real pointer/keyboard input for concurrent inserts/deletions, Markdown formatting, relative carets, author-local undo, native IME, offline merge, rapid exit/reload, slow local transactions, HTTP fallback, drag/resize previews, competing gestures, cancellation/deletion, follow/ping behavior, session grouping/revocation, viewer permissions, hostile origins, private Inbox moves, old queued-text recovery and acknowledged creation redo. Remote typing and committed movement have explicit one-second assertions.

Core/server regressions cover duplicate/reordered updates, canonical Markdown/state agreement, optimistic revision rollback, migration seeding once, stale removed-note rejection, explicit redo, one-use/expired room tickets, malformed authentication, server-derived identity, session/access revocation, private Inbox subscriptions and the 30-second disconnected-session deadline. Existing agent tests cover proposal approval, reversal, stale proposals and protected assets. Existing access tests exercise board moves and inherited permissions. Desktop browser tests cover bearer tickets and live connection state.

Regression fixes discovered during verification:

- Native DOM input can precede CodeMirror's document transaction: flush it before editor closure and recovery capture.
- Browsers can cancel queued IDB transactions on reload: a compact per-tab journal restores full Yjs state and its outbox atomically.
- Explicit creation redo must be distinguished from stale tombstone updates; ordinary old updates remain rejected.
- Hidden/moved rows must preserve inactive unsent drafts before removing their local copies.
- Commit authorization must publish sanitized membership immediately, clearing deleted previews without waiting for a heartbeat.
- Remote awareness must not echo local presence continuously.
- Minimal text splices must respect UTF-16 surrogate boundaries when replacing emoji.

## Performance

Measured on this machine's 120 Hz display, using the unchanged existing budget (`p95 < 1.25 × measured frame interval`, heap <150 MB, mounted cards <120):

| Scenario | Pan p95 | Far pan p95 | Heap | Mounted cards | Initial load |
|---|---:|---:|---:|---:|---:|
| 1,000 cards / 300 images | 9.0 ms | 9.2 ms | 10 MB | 35 | 326 ms |
| Same board, ten authenticated identities | 9.3 ms | 9.3 ms | 11 MB | 35 | 332 ms |

Nine other identities send cursor updates every 75 ms while the main page pans/zooms. Low-detail mode mounts zero card/image DOM in both runs. These are local measurements, not a production latency guarantee.

## Design review

Two independent design and technical reviews were completed, followed by one correction batch and one confirmation round. Internal assessment reports are omitted from the PR. Detector output is retained in `detector.json` and `browser-detector.json`.

The CLI scan found zero issues. Browser injection succeeded with CSP unchanged and displayed actual overlays; all five browser advisories were triaged as incumbent/expected/unproven. Both independent reviews identified inaccessible pings. The single correction batch added announcements, off-screen edge cues, action focus restoration, correct column/sticker geometry, and accessible connection state.

The first batched desktop/phone light/dark captures caught a sheet mid-animation. The one confirmation batch waits for animations to settle. All twelve `round-2` captures were inspected: settled phone sheets are readable, controls fit, themes match the app, and follow has an explicit exit. Keyboard/ping fixes have behavior assertions. Root also used the native browser manually to enter text, open people, send a named ping and confirm trigger focus plus the accessible announcement. Native browser keypress automation was inconclusive; automated Chromium/WebKit keyboard tests supply that evidence.

Temporary critique servers and task-owned browser processes were stopped before delivery. Questions skipped: the approved plan already authorizes these corrections. Research, roadmap, migration/release ordering, rollback constraints and operational metrics are in [multiplayer.md](../../multiplayer.md).
