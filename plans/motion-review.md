# Motion implementation review

Reviewed the selected changes against `animate`, `emil-design-eng`, `animation-performance` and `review-animations`, with the approved design-system exceptions preserved. This is a source review plus focused browser/gesture verification; physical-device sign-off is separate.

| Before | After | Why |
| --- | --- | --- |
| Fetch began every keyboard invocation transparent and scaled (`ui/canvas-entry.css:392`). | Fetch has no entrance animation (`apps/web/src/ui/canvas-entry.css:393`). Shared update-notice keyframes remain. | A frequent command surface is visible and focused immediately; repeated shortcut, search, result navigation and focus-return tests pass. **Approve.** |
| Add ignored activations for 350ms even after dismissal. | Direct state toggling (`apps/web/src/ui/MobileDock.tsx:75`) accepts deliberate reopening without a timer. | Real taps reopen inside the former rejection window in normal/reduced motion and retain synchronous editor focus. **Approve.** |
| Camera rAF interpolation ignored reduced motion. | `animateCamera` applies the exact target and completion callback immediately under reduced motion and finishes a live glide if the preference changes (`apps/web/src/canvas/Canvas.tsx:1680`). | No intermediate reduced-motion zoom matrices; normal interpolation and mobile edit framing remain functional. The pre-existing camera spatial behavior is a deliberately preserved scope decision. **Approve.** |
| Sheet cancellation committed dismissal, with an uncancellable 120ms timer cutting off a 180ms transition. | Pointer-specific sessions separate cancellation and release, preserve the current offset on re-grab, clean up on removal, and wait for a transform transition or a 230ms fallback (`apps/web/src/ui/sheet.ts:12`). | Cancellation, unrelated pointers, re-grabbing, removed sheets and reduced-motion completion pass. A grip-only native touchmove guard preserves real Chromium drag dismissal without suppressing body scrolling. **Approve.** |
| Toast entry replaced its centering transform and moved horizontally by a width-dependent amount. | `@starting-style` plus interruptible transform/opacity transitions preserve `translateX(-50%)`, with 160ms desktop/200ms mobile timing (`apps/web/src/index.css:2391`, `apps/web/src/ui/mobile.css:621`). | Short/long/replaced messages stay centered; mobile remains at the top; reduced-motion displacement is suppressed and Undo still restores the card. Unsupported `@starting-style` degrades to immediate visibility. **Approve.** |

## Verdict

**Approve all five selected fixes.** Integrated automated verification is complete; native and physical-device sign-off remains outstanding. No new feel-breaking regression, blanket `transition: all`, layout-property animation, per-card transform, motion dependency or inherited per-frame CSS-variable driver was introduced. Sheet settling uses only the element transform and the documented curve `cubic-bezier(0.22, 1, 0.36, 1)` for 180ms. Toast entry uses transform/opacity on the same documented curve; immediate dismissal is preserved.

## Verification and corrections

- The first focused run passed 115 cases and failed 15. Fourteen failures were test setup/probe problems: the toast test entered note editing before Backspace, and computed style inside a camera mutation callback lagged a paint. The tests now use the Bury control and rendered-frame sampling with a final sample.
- One real regression was found: native Chromium could claim a sheet-grip pull as browser scrolling, producing cancellation. The corrected handler prevents native touchmove only while a grip-origin pointer session is active; cancellation still rolls back and all session listeners are removed at release.
- The corrected focused run passed **130/130** with no retries across WebKit, Chromium, mobile WebKit and mobile Chromium. It includes both themes, normal/reduced motion, live preference changes, original mobile editing/shell behavior and new cancellation/interruption cases.
- Final workspace typecheck and **312 unit tests across 36 files** pass. The full production app and DMG build pass. Complete-suite diagnostics, passing isolated follow-ups and **4/4 final headed performance checks** are recorded in [the integration report](motion-results.md).
- Synthetic cancellation tests explicitly exercise a browser event path. Real Chromium grip dragging uses CDP touch input; WebKit drag helpers use pointer events. Neither substitutes for a physical-phone walkthrough.

## Deferred

Toolbar tooltip warm-delay consistency remains outside this selected pass. Existing documented dog overshoot, burial-copy motion and ordinary sheet entry timing are retained. No decorative animation was added.
