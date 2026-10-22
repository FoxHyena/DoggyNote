# DoggyNote motion audit — selection checkpoint

- Baseline commit: `c076eee2`; worktree was clean before this audit.
- Status: user selected all five with Q1 A; implementation, review and automated verification complete; native and physical-device walkthroughs remain incomplete.
- App source changes: all five selected fixes are implemented; see `motion-review.md` for focused verification and `motion-results.md` for integrated results.
- Stack: SolidJS, plain CSS and browser APIs; Tauri uses WebKit.
- Goal: make everyday interactions immediate, consistent and reliable without changing the visual identity, content measurements or canvas rendering model.

## Confirmed shortlist

This table preserves the baseline findings at the selection checkpoint, including checks that were still pending then. Ranked by expected user impact and correction effort. Each item was re-read at its cited source and reproduced in Chromium and WebKit. Severity follows the improve-animations audit rubric; it is not a security rating.

| # | Severity | Category | Location | Before | Proposed after | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | HIGH | Purpose/frequency | `apps/web/src/ui/canvas-entry.css:392`, `apps/web/src/ui/shortcuts.ts:60` | Every desktop Fetch invocation starts at opacity 0 and scale .98, then animates for 140ms. | Open and dismiss the frequent command surface immediately; retain input focus, results navigation and focus restoration. | Keyboard command feedback should not wait for an entrance effect. |
| 2 | HIGH | Input responsiveness | `apps/web/src/ui/MobileDock.tsx:47` | Add refuses activations for 350ms after the last accepted toggle, including after outside dismissal. | Allow deliberate reopening immediately; preserve predictable dismissal and synchronous card-creation focus. | Real touch reopen attempts at 174ms in Chromium and 162ms in WebKit were delivered to the button but ignored. |
| 3 | MEDIUM | Accessibility | `apps/web/src/canvas/Canvas.tsx:1680` | Programmatic camera pan/zoom always interpolates in rAF even with reduced motion enabled. | Apply the camera target immediately under reduced motion, cancel obsolete motion and preserve completion callbacks. | CSS reduced-motion rules cannot control JS interpolation. Both desktop and phone engines retained intermediate camera transforms. |
| 4 | MEDIUM | Cancellation/interruption | `apps/web/src/ui/sheet.ts:30` | `pointercancel` runs the same handler as release; the close timeout survives another grab. The 180ms departure is cut off at 120ms. | Cancelled gestures restore the sheet; deliberate release alone commits dismissal; re-grabbing cancels pending dismissal; cleanup removes obsolete listeners/timers. | A synthetic browser cancellation after a 100px pull closed the Boards sheet in both engines. Actual-source mock execution also demonstrated a stale timer closing a re-grabbed sheet; that second case still needs an integrated browser regression. |
| 5 | MEDIUM | Spatial consistency | `apps/web/src/index.css:2382`, `apps/web/src/ui/canvas-entry.css:222` | Desktop toast centers with `translateX(-50%)`, but its entry keyframe replaces that transform with `translateX(24px)`. | Keep horizontal centering throughout the entrance and use a short, bounded, width-independent offset; keep mobile positioning and Undo behavior. | A 190px-wide toast traveled about 119px horizontally. Travel distance currently grows with message width. |

## Evidence

- [Chromium desktop recording](motion-audit-evidence/chromium-desktop.webm): keyboard Fetch, burial toast, reduced-motion zoom.
- [WebKit desktop recording](motion-audit-evidence/webkit-desktop.webm): the same sequence.
- [Chromium phone recording](motion-audit-evidence/chromium-phone.webm): Add → outside dismissal → reopen; cancelled sheet; reduced-motion zoom.
- [WebKit phone recording](motion-audit-evidence/webkit-phone.webm): the same sequence.
- [Measured observations](motion-audit-evidence/observations.json): animation properties, input event times and per-frame transforms. No credentials are included.
- [Capture script](motion-audit-evidence/capture.mjs): uses local fixture accounts and writes fresh captures under ignored `apps/web/test-results/motion-audit-baseline/`.

The camera captures reported 15 distinct transforms on Chromium desktop, 8 on Chromium phone, and 24 on each WebKit device while the reduced-motion media query matched. The recorded zoom interpolated for about 220ms. Fetch's initial opacity was 0 in both desktop engines. Toast movement was 119.23px in Chromium and 119px in WebKit.

The phone Add sequence uses real Playwright touchscreen taps with 90ms and 60ms pauses around outside dismissal. Sheet cancellation uses a synthetic pointer stream because a browser cancellation is not an ordinary tap; this is browser event-path verification, not physical-phone validation. The recordings show settled geometry as well as the transition; their frame rate alone cannot establish frame-time performance.

## Passing baseline

Command run from the repository root:

```sh
E2E_PORT_OFFSET=120 pnpm --filter web exec playwright test '(^|/)(navigation|mobile-shell|mobile-sheet-keyboard)\.spec\.ts$' --project=webkit --project=chromium --project=mobile-webkit --project=mobile-chromium --workers=2 --trace=on
```

Result: **38 passed, 0 failures, no retries**. The run built the web and desktop-flavor web bundles and exercised navigation, menus, tooltips, focus restoration, mobile card creation, photo input, grip dismissal, keyboard positioning, selection, burial/Undo and comments. Build output reported the existing large-chunk advisory; live-connection teardown produced proxy reset/broken-pipe messages without test failures.

Initial sandboxed dependency/server attempts could not access the network or local daemon; ordinary escalated execution succeeded. Locked dependencies were installed without changing the lockfile. A separate recording attempt initially used an overly strict zoom button locator; it was corrected before the complete captures above. An initial two-tap Add probe could hit the overlaid sheet instead of the button and was rejected; the recorded outside-dismiss/reopen sequence checks actual Add click timestamps.

The isolated recording environment uses web 5295 and Worker 8908. To recapture, start `PORT=8908 DESKTOP_PORT=4294 FIXTURE_PORT=5300 pnpm --filter server e2e:serve`, then `API_PORT=8908 pnpm --filter web preview --port 5295 --strictPort`, then `node plans/motion-audit-evidence/capture.mjs` after a baseline production web build. Supply the local test account through `MOTION_FIXTURE_USER` and `MOTION_FIXTURE_PASSWORD` environment variables. The capture script signs in separately for each context; credentials and saved sessions are not included in the evidence.

## Preserved decisions and deferred work

- Preserve the documented 120ms hover feedback, 140–160ms ordinary pop-ins, 200–240ms phone sheets, reserved dog overshoot, and the intentional 380ms burial-copy animation. No blanket curve or duration rewrite is proposed.
- Preserve card `left`/`top` placement, measured content dimensions, offscreen culling, low-detail canvas rendering, and world-only camera transforms. Do not add a motion library.
- Sticker playback already observes reduced motion and visibility/camera activity; no confirmed change is proposed there.
- LOW priority: adjacent `[data-tooltip]` toolbar controls repeat their 400ms cold delay, while `[data-tip]` uses a warm interval but still restarts its entry keyframe. Source-confirmed; defer runtime reproduction and correction to a later pass.
- No additive animations are proposed for this corrective pass.
- At the audit checkpoint, full workspace checks, the complete end-to-end suite, headed performance comparisons, Tauri walkthrough and physical-phone checks were outstanding. Their current results and remaining hardware gaps are in [the integration report](motion-results.md).

## Selection and completion gate

Selected: **all five**, confirmed by the user with **Q1 A**. The requested selection checkpoint is complete; implementation plans and their statuses are indexed in `README.md`.

All five implementations have a Before/After/Why review and an Approve verdict in `motion-review.md`. Integrated check results, original failures, corrections and hardware gaps are tracked in `motion-results.md`. The overall success state remains subject to the stated verification requirements.
