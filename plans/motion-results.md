# DoggyNote focused motion polish — results

Status: **all five selected fixes implemented and review approved; automated verification complete. Native and physical-device walkthroughs remain incomplete.**

## Resulting behavior

| Interaction | Result |
| --- | --- |
| Fetch | Visible immediately on the first frame, with keyboard results and focus restoration preserved. |
| Mobile Add | Deliberate reopening works inside the former 350ms rejection window; new-note focus stays synchronous. |
| Reduced-motion camera | Applies the exact target in one update, invokes completion behavior and handles a preference change during a glide. |
| Sheet gestures | Cancellation restores the sheet, unrelated pointers cannot commit it, re-grabbing revokes dismissal and removal cleans up its session. |
| Toasts | Stay horizontally centered throughout entry for different message widths; mobile positioning and Undo remain functional. |

The design-system motion section records these contracts. Ordinary sheet entry, reserved dog overshoot, burial-copy motion, measured card content and canvas rendering architecture are preserved. No server API, schema, dependency or permission change was needed.

## Evidence

| Capture | Before | After |
| --- | --- | --- |
| Chromium desktop: Fetch, toast, reduced-motion zoom | [Recording](motion-audit-evidence/chromium-desktop.webm) | [Recording](motion-audit-evidence/after/chromium-desktop.webm) |
| WebKit desktop | [Recording](motion-audit-evidence/webkit-desktop.webm) | [Recording](motion-audit-evidence/after/webkit-desktop.webm) |
| Chromium phone: Add, cancelled sheet, reduced-motion zoom | [Recording](motion-audit-evidence/chromium-phone.webm) | [Recording](motion-audit-evidence/after/chromium-phone.webm) |
| WebKit phone | [Recording](motion-audit-evidence/webkit-phone.webm) | [Recording](motion-audit-evidence/after/webkit-phone.webm) |

Measurements in [before observations](motion-audit-evidence/observations.json) and [after observations](motion-audit-evidence/after/observations.json) confirm:

- Fetch starts at opacity **1**, identity transform, and no animation in both engines; before it started at opacity 0 with a 140ms entrance.
- Desktop toast horizontal travel is **0px** in both engines, previously about **119px** for the same notification.
- Add reopens after outside dismissal in **171–187ms**, inside the former 350ms guard; the cancelled Boards sheet stays connected after settling.
- Reduced-motion camera captures contain only the starting and final matrices (**2** distinct values), previously **8–24** intermediate/start/final matrices depending on engine and device. Ordinary zoom still interpolates.

These recordings use Playwright browser engines and emulated phone profiles. Chromium's existing drag helpers use real CDP touch input; explicit cancellation and WebKit drag helpers use pointer event streams. They establish browser behavior, not physical-phone performance.

## Verification

| Check | Result |
| --- | --- |
| Baseline navigation/mobile shell | 38 passed |
| Corrected focused motion/navigation/mobile editing suite | **130 passed**, no retries |
| Workspace typecheck | **Passed** |
| Unit tests | **312 passed** across 36 files |
| Production build | **Passed**, including app and DMG |
| Isolated native QA build | **Passed**; launch and local fixture sign-in/board load verified |
| Initial combined browser run | **926 passed, 7 skipped, 9 failed**; preserved in [full log](motion-audit-evidence/full-combined.log) |
| Complete Chromium project, fresh backend | **338 passed, 2 skipped**, retries disabled; both original sync timing cases passed |
| Corrected WebKit fixtures and complete touch projects | **277 passed**, retries disabled |
| Headed canvas/sticker comparison | **4 passed** before and after; serial headed Chromium, unchanged budgets |
| Physical-phone walkthrough | **Unverified:** the physical iPhone is offline |
| Remaining native UI walkthrough | **Unverified:** stopped CUA use at the user's request |

Logs: [complete Chromium project](motion-audit-evidence/chromium-isolated.log), [WebKit fixtures and complete touch projects](motion-audit-evidence/cross-engine.log), [focused pass](motion-audit-evidence/focused-passed.log), [typecheck](motion-audit-evidence/typecheck.log), [unit tests](motion-audit-evidence/units.log), [production build](motion-audit-evidence/build.log), [native build](motion-audit-evidence/native-build.log), [baseline performance](motion-audit-evidence/perf-before.log), [final performance](motion-audit-evidence/perf-after.log). The large-chunk build advisory remains; no size or timing budget was relaxed.

### Performance comparison

Both runs used the existing performance specs in headed Chromium, serially. [Raw measurements](motion-audit-evidence/performance-comparison.json) preserve full frame samples and resource counters.

| Measurement | Before | After |
| --- | ---: | ---: |
| Canvas pan p95 | 10.8ms | 11.0ms |
| Canvas zoom-out p95 | 10.7ms | 10.9ms |
| Distant pan median p95 | 11.0ms | 10.8ms |
| Canvas heap / DOM nodes | 12MB / 731 | 12MB / 731 |
| Sticker overview / detail p95 | 10.7 / 10.7ms | 10.9 / 10.8ms |
| Sticker tray closed / open p95 | 10.7 / 10.7ms | 10.9 / 10.8ms |
| Animated sticker pan p95 | 10.6ms | 10.9ms |

All existing relative frame-time, culling, playback and resource assertions passed. These measurements show no budget regression; small timing differences between runs are not evidence of a speed improvement.

### Full-suite diagnostics and test maintenance

The initial combined run shares one accumulating database across all desktop and touch projects. CI instead gives desktop engines their own backend. The combined run exposed these existing test assumptions:

- `access.spec.ts` read one sync page. Later Chromium cases had objects beyond the 1000-row page limit; it now uses the existing `pullAllObjects` helper.
- A label-color assertion could read a detached chip and receive an empty computed value. It now uses Playwright's retrying CSS assertion on the live locator.
- The mobile todo gutter helper asserted that a bounding box could never be null while sync was rendering. It now samples a live box using the same polling approach as the existing touch helpers, without a fixed delay or weaker task-state assertion.

Two sync timing failures and a tablet initial-load timeout occurred in the accumulated shared database. The sync traces show repeated access-revision resets while other tests mutated access; the tablet snapshot remained on Fetching. The [credential-free trace summary](motion-audit-evidence/combined-suite-sync-diagnostics.json) preserves the response timeline. The complete Chromium project passed on a fresh backend matching CI isolation: **338 passed, 2 intentional skips, no retries**, including the original strict timing cases. Corrected WebKit fixtures and all phone/tablet projects then passed **277/277**, without retries. The original strict timing assertions remain unchanged; no sync implementation change is included in this motion pass.

Across these runs, all **935 non-skipped browser cases** have a passing result; **7 intentional skips** remain. This is coverage across verification runs, not a claim that the original combined invocation passed. The shared-database concurrency sensitivity remains outside the selected motion scope. Generated sticker-suite screenshots were archived outside the source tree; the linked motion recordings and measurements are retained here.

The first focused implementation run also found and corrected a real native Chromium grip issue: the browser could claim the pull as scrolling. A native touchmove guard now applies only during grip-origin sessions, leaving ordinary sheet-body scrolling available. See the [motion review](motion-review.md) for the initial failures and their resolutions.

## PR integration

The branch was rebased onto `6ddbe4c5` (the merged Phosphor icon update). The Add-button conflict was resolved by preserving the new icon markup and the immediate toggle handler. Typecheck and **312 unit tests** pass again. The final focused interaction suite plus the upstream icon checks pass **138/138**, without retries, on both desktop and phone engines. The suite rebuilt both production web flavors. Logs: [focused and icons](motion-audit-evidence/pr-focused.log), [typecheck](motion-audit-evidence/pr-typecheck.log), [units](motion-audit-evidence/pr-units.log).

The performance comparison above isolates the selected motion changes before the icon integration. After rebasing, all **4 headed performance checks passed again**, serially, with unchanged assertions. Canvas pan and zoom-out p95 were both **11.0ms**, heap **12MB** and DOM nodes **473**. [Final PR performance log](motion-audit-evidence/pr-performance.log) and [measurements](motion-audit-evidence/pr-performance.json) preserve this separate run.

### CI probe correction

The [first PR CI run](https://github.com/FoxHyena/DoggyNote/actions/runs/39839416424) passed Chromium, the first WebKit shard, typecheck/unit tests and performance. Touch finished with **263 passed, 2 failed and 1 flaky**. Both re-grab failures sampled an offset of zero after a single rAF; the flaky toast check collected only three samples inside its 280ms observation window, below an arbitrary six-frame requirement. These browser probes were sensitive to Linux WebKit rendering and runner scheduling.

The re-grab test now flushes and verifies the 100px synthetic pull, then pauses the actual CSS departure at 60ms before re-grabbing. It still requires a real departure transition, continuity at the grab, cancellation of the real dismissal fallback and restoration of the original position. The toast probe waits for its complete observation window and checks mount plus rendered geometry, retaining the same 1px horizontal-travel assertion without adding a frame-rate budget to an interaction test. Product code and existing performance assertions are unchanged.

The first repeated local run passed **131/132**, including every corrected re-grab and toast case. One Add setup took 376ms because it combined 150ms of fixed pauses with runner latency, missing the old guard window. The fixed pauses were removed; real touchscreen taps, the strict **less than 350ms** assertion, visible reopening and editor-focus assertions remain. The complete corrected motion matrix then passed **132/132** across both desktop and phone engines, with two repeats and no retries. [Corrected-probe log](motion-audit-evidence/ci-probes-corrected.log). Follow-up CI status is tracked in [PR #69's checks](https://github.com/FoxHyena/DoggyNote/pull/69/checks).

### CI runner setup correction

The next run passed typecheck/unit tests, performance and WebKit shard 2, while three browser jobs spent more than ten minutes installing system dependencies. The earlier cancelled WebKit job log identifies the same bottleneck: after 18 minutes it was still fetching part of the 117MB dependency set from `http://azure.archive.ubuntu.com`.

Before browser installation, CI now removes that HTTP Azure entry from the runner's mirror list. The HTTPS Ubuntu archive and security fallbacks, already configured by the [official runner-image script](https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt-sources.sh), remain. Browser versions, package selection, signature verification, test commands, retries and performance budgets are unchanged. This narrow setup correction is included to let the actual checks run before merging.

## Completion boundary

All selected fixes have an explicit **Approve** verdict in [the review](motion-review.md). Integrated automated verification is complete. Native and physical-device walkthroughs remain separate, visible requirements; this report does not claim the original hardware success state has been reached. The progress run remains open for these checks.

Toolbar tooltip warm-delay consistency remains deferred. Further CUA interactions are excluded following the user's steering; all subsequent verification uses CLI/browser automation and local artifacts.

The [post-deployment iPhone checklist](iphone-smoke-test.md) covers the remaining phone walkthrough and records a concrete pass state.
