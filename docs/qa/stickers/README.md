# Telegram stickers QA

Status: the mobile bottom-right sticker shelf is implemented and verified on both phone engines. Final strict full run: **439 passed, four intentional skips, retries disabled, no failures**. Typecheck, **162** unit/integration tests and the latest web/app/DMG build pass. Direct native TGS/WEBM transparent-still previews and bone placement are verified; **native tray drag remains unverified and was subsequently waived by the user**. Hosted bot verification is the next requested work. Public HTTPS webhook delivery remains unverified and publication is outside this local goal. See the [requirement audit](completion-audit.md) and latest checkpoint; earlier checkpoints preserve historical failures/fixes. Work began 2026-10-20 from an unmodified implementation (only the goal brief was untracked).

## Requirements and evidence checklist

- [x] Link normalization, private preview, explicit/idempotent add, partial retry and removal/recovery
- [x] Bot pairing: expiring single-use challenge, authenticated identity confirmation, replay protection, pending pack, missing metadata, disconnect/reconnect
- [x] Private collection, favorites, recents, local search, cross-device refresh
- [x] Desktop drag/cancel, tap arming, keyboard placement, long-press preview and scroll cancellation
- [x] Board overlays: ordering, alpha hit testing, underlying selection, aspect-preserving radial resize/rotation, accessible controls
- [x] One-step undo/redo, cancellation, duplication/copy/paste, deletion/restore, reload, sync and reconnect
- [x] Access grants, private Inbox, share bytes, old-reader preservation, agent schemas
- [x] Static, TGS and WEBM transparent rendering, bounded playback, stills, reduced motion, export
- [x] Performance baseline and sticker-heavy board, culling/LOD/off-screen pause
- [x] Engineering self-review and fixes
- [x] UX self-review with ordinary pointer/touch/keyboard input
- [x] Visual round 1 and cleanup: required state/viewport/theme matrix
- [x] Visual round 2: latest build recapture and complete task regressions
- [x] Final typecheck, unit/integration, build, complete E2E after mobile shelf/alignment fixes (439 pass, four intentional skips, no retries/failures)
- [ ] Live configured Telegram test and freshly built isolated native app review

## Architecture and interaction plan

- Distinct `sticker` objects in the existing field-patched document, independent of cards/columns/connectors. One scalar width with immutable intrinsic aspect ratio avoids separate width/height conflicts. x, y, width, angle and order use independent top-level sync fields. Last arriving write wins only the field changed; existing outbox acknowledgment and busy-gesture deferral apply.
- An isolated overlay layer sits above cards, including at overview zoom, with rotated-bounds culling. World pan/zoom updates only the world transform; wrappers use left/top and rotation is inside. Explicit ordering is independent of card z.
- Preview, armed placement and drag are mutually exclusive. Touch scrolling wins over pending long press; preview release cannot commit. Tap arming collapses the tray. No new global shortcut.
- Private D1 collection/membership/preferences and bot tables stay outside board sync. R2 asset access requires private collection/preview ownership or a readable placed board reference. Removal never garbage-collects placed assets. Assets are immutable and retained, including undo/trash references; automated deletion is deferred.
- All Telegram access originates on the Worker with identifier validation, bounded/time-limited requests, no arbitrary pasted URL fetches, and sanitized errors. Pairing starts in the signed-in app and requires confirmation there after a Telegram identity claims the challenge.
- Animation strategy: transparent server-stored still for every usable sticker. Bounded lazy playback only where supported; export, reduced motion and overview use stills. Format support is incomplete until verified across required engines.

## Research actually performed

2026-10-20: read official Bot API, deep-link guide and Telegram Desktop `stickers_list_widget.cpp` via web tools. Source review only, no native Telegram observed. Doggynote chooses an explicit board placement step, unlike chat sending.

- https://core.telegram.org/bots/api#getstickerset
- https://core.telegram.org/bots/api#getfile
- https://core.telegram.org/bots/features#deep-linking
- https://raw.githubusercontent.com/telegramdesktop/tdesktop/dev/Telegram/SourceFiles/chat_helpers/stickers_list_widget.cpp

## Findings

| Severity | Reproduction / finding | Fix | Verification |
| --- | --- | --- | --- |
| Medium | Mobile landscape launcher covered preview Favorite star | Hide launcher while fuller preview/import surfaces are open | Actual phone Favorite tap/pressed-state assertions, inspected final landscape preview, full strict suite |
| Medium | New shelf ghost was above the finger but release used the finger coordinate | Share the touch offset in ghost rendering and drop conversion | Both phone engines assert placed center equals lifted preview center |
| Low | Generic icon-button pressed styling dimmed the launcher | Dedicated button styling and theme-accent expanded state | Actually inspected final light/dark phone captures |
| QA | Delayed fixture height sync, fixed-duration gesture timing and raw fixture write made full checks fail | Observe persisted measured heights, visible lift, existing bounded409 fixture helper plus body diagnostics | 27 repeated cases and final439-test strict full run; original untraced causes remain qualified below |
| Info | `paseo-progress show` reports progress plugin unavailable or Paseo unreachable | Keep this QA record current | Command executed; dashboard unavailable |

## Checks run

- Repository/architecture inspection: `CLAUDE.md`, core model/patch/geometry, canvas gestures/layout/paste, doc store, sync/access/assets/shares, export, toolbar/mobile controls, agent validators, E2E configuration and Worker startup.
- `paseo-progress show`: exit 1, plugin unavailable or Paseo unreachable.

## External checks

Current: a dedicated test bot/account was configured privately. Live `hyenafox` link import and the explicitly confirmed bot-assisted `spottedhyenaNL` import passed; public HTTPS webhook delivery was not tested or deployed. Native tooling built and launched the isolated app; remaining native checks are listed in the latest checkpoint. No real token or webhook secret is included in this QA record.

## Implementation/checkpoint 1

- Added independent sticker model, strict agent schema, rotated bounds/local resize, private D1 collections and bot challenges, controlled Telegram/R2 preparation, board-sync provenance validation and asset authorization.
- Added initial desktop/mobile tray, preview vs placement states, direct transform gestures and precise controls, undo integration, retained assets, share/export inclusion, and deterministic test artwork/Worker seed.
- Playback uses a lazily imported expression-free Lottie canvas player for selected/previewed TGS only, at most two loops. Chromium video playback is gated; WebKit deliberately uses the transparent still. Real-format verification is still pending.
- `pnpm install --frozen-lockfile`: sandbox attempt could not resolve registry; authorized escalation succeeded. Added pinned `lottie-web@5.13.0`; existing wrangler/workers-types peer mismatch warning reported by pnpm.
- `pnpm typecheck`: passed before animation addition; latest animation addition is being rechecked.
- `pnpm test` (initial implementation): 12 files / 146 tests passed.
- `pnpm exec vitest run apps/server/src/stickers.integration.test.ts packages/core/src/stickers.test.ts`: 2 files / 11 tests passed. Covers one-step pure transform undo, rotation geometry, invalid inputs, idempotent preview/add, permissions, retained bytes, share-to-Inbox revocation, independent preference updates, bot confirmation/replay/expiry/disconnect, bounded bytes and rate-limit response.
- `pnpm build`: web and native binary/app bundle built; overall exit 1 because desktop DMG creation failed with `hdiutil: create failed - Device not configured`. This is packaging/environment failure, not a passed build. No deployment performed.
- First focused Playwright attempt: no tests executed; sandbox denied listening on localhost:5175 (`EPERM`). Retrying with authorized local-server execution.

| Severity | Reproduction / finding | Fix | Verification |
| --- | --- | --- | --- |
| High | Telegram 429 escaped middleware and became generic 500 under Hono | Registered a route-level error handler | Worker integration asserts HTTP 429, Retry-After 17, no token exposure; passes |
| Medium | Existing union readers assumed all asset-bearing objects are cards | Extended agent dependency checks and field-patch typing; added isolated rendering path | Typecheck and server/geometry suites pass at checkpoint |

| Severity | Reproduction / finding | Fix | Verification |
| --- | --- | --- | --- |
| Medium | Pointer drag canceled with Escape restored geometry but the app shortcut cleared selection before the canvas handled cancellation | Handle canvas Escape during capture, before ordinary shortcuts | First pointer E2E failed waiting for rotation handles; rerun pending |
| Medium | Corrupt still headers could declare huge decoded dimensions despite a small download | Validate PNG IHDR / WebP canvas dimensions (at most 512 each) before R2 storage | Focused Worker suite passes with valid PNG fixture |

Focused Chromium browser run: first complete link → preview → add → preview/favorite → cancel → keyboard place/size/angle → undo/redo → duplicate → delete/restore → reload → remove pack → anonymous share passed. Second pointer case found the Escape selection bug above. This is a failed run (1 passed, 1 failed), not overall acceptance.

## Engineering / UX review checkpoint 2

Read the model, schema, sync authorization, asset routes, collection and pairing SQL, gesture lifecycle, document indexing, export, controls and tray diff as a maintainer. Review remains open until remaining coverage and final checks complete.

- Kept sticker transforms out of the document-wide index dependencies. Validation now happens at sticker readers, so moving a sticker does not rebuild every card index.
- Resize now accounts for the exact initial grab point (including touch handle margins), avoiding a jump on pickup. Both world dimensions are bounded, including tall sticker aspect ratios.
- Added PNG/WebP dimension validation and conservative shape-only TGS validation (bounded depth/nodes, no external media/fonts/text/expressions). Client uploads cannot mutate server-managed Telegram bytes.
- A usable still survives failure to prepare optional playback; the pack preview reports still fallback explicitly.
- Existing protocol 2 remains additive: old clients patch only changed fields and ignore unknown kinds in their indexes. Integration coverage verifies an old-style board patch preserves a sticker row. Broader old-desktop runtime verification is still pending.

| Severity | Reproduction / finding | Fix | Verification |
| --- | --- | --- | --- |
| Medium | Collection refresh replaced identical tile identities while a drag held pointer capture; WebKit outside-drop case occasionally lost its tile | Preserve unchanged collection/preference arrays | Rerun pending |
| Medium | Selection handles inside an earlier sticker's rotation context could be visually covered by later stickers | Separate selection chrome layer above all sticker artwork; art order remains unchanged | Typecheck passes; pointer/visual recapture pending |
| Medium | Return from an enlarged preview remounted the grid at scroll zero | Save/restore pack scroll on grid remount and focus the originating asset | Touch/keyboard regression pending |
| Test harness | Visual sweep resized from desktop to phone, then tested a toolbar locator before the responsive app update completed | Read the same phone media query and wait for the appropriate trigger | First sweep: 8 pass / 3 fail; complete recapture pending |

Actually inspected first-round PNGs: Chromium decorated selected board (five overlapping stickers across note/photo/column), WebKit light 600px tray. No rectangular sticker shadow was visible in these inspected states. This is partial visual evidence, not matrix completion.

## Visual round 1 — inspected and cleaned up

The corrected focused run passed **11/11** across desktop Chromium/WebKit, iPhone WebKit, Pixel Chromium and iPad WebKit. The fixture bot E2E used the isolated local Worker webhook; no Telegram account or real bot was messaged. First-round matrix captures cover 1440×900, 1024×768, 720×720, 600×720, 390×844, 360×740, 768×1024 and 1024×400, light/dark, on both desktop engines. Four matrix contact sheets were actually opened and inspected, plus full-size selected collage, 600px tray, 360px tray, 390px preview, short desktop preview, and bot pairing.

Evidence: [light Chromium matrix](round-1/matrix-chromium-light.jpg), [dark Chromium matrix](round-1/matrix-chromium-dark.jpg), [light WebKit matrix](round-1/matrix-webkit-light.jpg), [dark WebKit matrix](round-1/matrix-webkit-dark.jpg). These contact sheets retain the first cleanup review; representative raw frames were later regenerated by the final suite and are recorded under round 10 rather than presented as historical captures.

Inspection: tray/preview bounds fit these viewports, no rectangular sticker backgrounds/shadows, grids are even, and preview actions remain readable in short windows. Grid rows are intentionally clipped by the scroll viewport; scrolling reveals the remaining rows. Changing from a wide viewport to a phone preserves the camera, so the collage lies outside those particular phone captures; real phone placement is covered separately. Landscape phone, loading/error, export, alpha picking and second-session verification are still pending.

Further review fixes (recapture pending): kept unchanged tile identities during collection refresh; restored preview origin focus/scroll; separated handle chrome from sticker ordering; moved overview stickers into the existing atlas canvas rather than leaving hundreds of image nodes mounted; corrected touch allowance for intrinsic aspect ratio. Review also found that clicking a not-yet-added preview tile could arm a local placement despite server rejection. Such tiles now open enlarged preview; placement remains unavailable until Add pack succeeds.

## User-supplied live pack

2026-10-20: user supplied `https://t.me/addstickers/hyenafox` for additional testing. The local worktree has no `.dev.vars` or Telegram environment configuration files. The manual/E2E Worker uses an explicitly labeled fixture-only placeholder, not a real Bot API credential. Real Bot API import of this pack remains unverified until a configured test bot token is available. Public Telegram preview inspection is separate evidence and will not be counted as live DoggyNote import.

Public-page check for the supplied pack: Telegram's Open Graph title reads “Add sticker set Oreo the Fox Hyena on Telegram”. This confirms the pack's public title only. No Bot API import has run. The native QA app is isolated under bundle ID `dog.doggynote.stickersqa`, uses web token storage and local fixture Worker port 8789; the ordinary DoggyNote app is not used for this review.

## Live hyenafox verification

With the user's locally configured test bot (`@DoggyNoteBot`), verified identity through Telegram `getMe` without displaying the token. The token is only in ignored owner-readable `.dev.vars`; none was placed in source, command arguments, app metadata, or screenshots.

Live browser walkthrough: **34/34** stickers from **Oreo the Fox Hyena** prepared through Bot API → Worker → local R2, previewed/added in the real app, placed, resized to 220 world pixels, rotated to 24°, and rendered after reload. All assets in this pack are static, so it does not prove TGS/WEBM support. [Machine-readable result](live/result.json), [real pack tray](live/hyenafox-tray.png), [real sticker placement](live/hyenafox-placed.png), [loading preview](live/hyenafox-preview-loading.png). The tray and placement screenshots were actually opened and inspected; transparency and silhouette shadow look correct for the inspected assets.

The first live run resolved and placed a sticker but a local static build reloaded Wrangler mid-download (HTTP 503), leaving 24/34 ready. Retrying completed all 34. This exposed a missing partial-pack retry affordance in collection view, now added (latest UI verification pending).

Live-only finding: local workerd threw on `redirect: 'error'` despite mocked fetch tests accepting it. Requests now use manual redirects and explicitly reject 3xx, preserving the trust boundary. TLS verification stayed enabled; a system CA bundle was provided to the local runtime while diagnosing transport. No service was deployed.

The bot has no registered webhook. A temporary opt-in QA polling bridge reads genuine Telegram updates and forwards only the pairing challenge's matching test account to the production local webhook handler. It sends no messages and changes no webhook registration. Live pairing awaits the user's Start → in-app confirmation → hyenafox sticker action; public HTTPS webhook delivery remains unverified.

## Live pairing completed and loading concurrency

The dedicated test identity pressed Start, explicitly confirmed its account in DoggyNote, and sent a real sticker. Telegram reported `spottedhyenaNL` (not `hyenafox`); the initial QA script incorrectly hardcoded the latter's title and was corrected to accept the actual suggested set. The real suggested preview and explicit Add pack succeeded. [Pairing result](live/pairing-result.json) records success, with [suggested pack preview](live/telegram-live-pack-preview.png). Real updates were polled and forwarded to the authenticated local handler. Public HTTPS webhook delivery remains unverified; no webhook registration or production deployment was changed. `hyenafox` link import separately prepared all 34 static assets. The bot-suggested `spottedhyenaNL` also finished all 120 assets; both real sets are static.

At the user's request, loading now uses **two concurrent six-sticker chunks**, each preparing **two assets at a time**. This allows four asset preparations across the two chunks while staying below the Worker's request budget. Each completed entry uses an independent JSON update. Client responses merge ready entries so an older chunk response cannot roll progress back. Rate limiting stops scheduling new ranges, drains the already active requests and exposes Retry-After. Server integration measured four concurrent upstream operations across two ranges; browser checks measured two overlapping chunk requests and deliberately reversed their completion order without losing any of 12 ready assets. This is concurrency evidence, not a claim of a measured live speedup.

## Visual/engineering review rounds 2–3

Actually opened and inspected the two [Chromium](round-2/review-chromium.jpg) and [WebKit](round-2/review-webkit.jpg) state contact sheets, a full-size timeout/retry state and the iPhone landscape preview. Both state sheets include populated collage, selection, lifted ghost, empty collection/search, loading, Added pack and bot pairing. The landscape preview initially hid most of its Place/Favorite/View pack actions below the fold. Short windows now put the artwork beside those actions. The revised phone test asserts the Place action fits inside the tray; round 3 captures and full-suite phone checks passed. [Landscape cleanup](round-3/landscape-cleanup.jpg).

| Severity | Finding / reproduction | Fix | Verification |
| --- | --- | --- | --- |
| High | Selected sticker controls could cover the topbar Export menu | Keep sticker panels below the topbar's established stacking level | Both-engine PNG export checks pass |
| Medium | Keyboard test could activate a preview before the asynchronous Add pack operation finished | Wait for the collection transition, then verify focus and Space; canvas Space-to-pan also respects focused buttons | Both-engine keyboard walkthrough passes |
| Medium | Landscape preview actions started below the visible sheet | Side-by-side short-window preview layout | Phone bounds assertion and recapture pass |
| Medium | Bot intentionally sends no reply, but a test user reasonably expected one | Waiting copy explicitly says to press Start and return to the app; bot does not reply in chat | Real Start, confirmation and suggested pack verified |
| High | A pull deferred during manipulation could later restore an old committed width after its outgoing patch had been acknowledged | Preserve the pending committed overlay at the moment the remote row is deferred | Tablet and reconnect regressions being rerun |
| Medium | Overlapping personal-collection refreshes could apply an older response last | Only the latest refresh request can replace collection/preferences | Affected collection checks being rerun |

The first complete E2E attempt ran **433 cases: 420 passed, 4 skipped, 9 failed**. Four failures came from preview copy changing “cards” to “objects”; copy now says “cards or stickers.” Two new tests failed on harness assumptions (Recent resets after reload; waiting for Add completion); both were corrected and passed focused checks. One existing scoped-asset proposal check returned 409 under concurrency but passed on both engines in the focused rerun; error-body diagnostics were added and it remains part of the final complete run. The tablet stale-width finding is addressed above. An earlier focused PNG test also mistakenly exported the selected sticker instead of Whole board; explicitly selecting Whole board verifies stacking changes at the PNG pixel level.

Actual fixture formats now include a decoded shape-only TGS and an original transparent VP9-alpha WEBM. Both engines verified TGS corner alpha 0 / center alpha 255, bounded two-loop playback and reduced motion. Chromium verified actual WEBM frame alpha and bounded playback; WebKit deliberately displayed its transparent still. Chromium only hides the still after a decoded frame proves alpha is present; oversized/long videos, opaque decoding and errors keep the still.

## Circular control requested by the user

The user requested a circle in place of separate rectangular selection/resize/rotate handles. A single radial drag now changes angle and proportional size together about the fixed visual center: movement around the ring turns; movement toward/away from the center scales. Any point on the circumference is a valid grab point. Artwork dragging still moves the sticker. Numeric Size/Angle and Reset remain available for precise/keyboard adjustment. One combined drag is one undo transaction; Escape/pointer cancellation restores its complete original transform, and canvas pinch cancels the sticker gesture first. This supersedes the earlier box/handle design in this log.

Core geometry tests cover aspect, fixed center, arbitrary grab points, angle wrapping and clamps. Desktop tests now exercise the actual ring at several zoom levels and verify combined size+angle, one-step undo/redo and cancellation. Phone/tablet use the same circular control. Initial WebKit review found SVG stroke pointer retargeting; selected-ring picking now has the same geometric circumference check as its visual dimensions, with a small touch allowance and no central pointer-catching area. Final ring regressions and recapture are in progress.

## Native review status

The required full `pnpm build` succeeded outside the disk-device sandbox, including `.app` and DMG. A fresh isolated `DoggyNote Stickers QA` bundle was also built against the local Worker. Native sign-in, pack preview and the confirmed bot connection were observed. **Drag, transform, format fallback and quit/reopen persistence are still incomplete.** Computer-use requests first timed out; a later request was denied with “Computer Use was not approved to use DoggyNote Stickers QA,” with no further reason supplied. No native pass is claimed from browser WebKit results. The circular-control QA bundle is being rebuilt for this final review.

The concurrency bound was also checked against [Cloudflare's current Worker limits](https://developers.cloudflare.com/workers/platform/limits/): from this implementation, six animated stickers use at most 24 external fetches; each Worker schedules only two preparations concurrently. D1/R2 operations have their separate internal-service limit. This is a code-level budget check; no hosted deployment/load test was run.


## Final reader and interaction fixes

The intermittent full-suite agent failure was diagnosed from its response body: `Cannot read properties of null (reading 'assetId')`. A previously purged image had cleared content, and scanning all existing image/file references dereferenced it. Both existing card and new sticker reference scans now tolerate cleared content. The scoped-asset E2E explicitly seeds a cleared image before the usable assets, so the regression is deterministic. Access scope requirements remain in place. This was a real existing-reader defect exposed by the complete suite, rather than a timeout to ignore.

The ring review rerun passed 45 cases, skipped the WebKit-only performance case, and failed only a CSS serialization assertion: Chromium reported the center 0.0005 world pixels from zero. Core geometry preserves the exact center; the DOM assertion now allows 0.005 pixels of browser style rounding. Desktop WebKit and both phone engines passed the circular gestures, and the tablet pinch/reload case passed after the deferred-row fix. The last full run also adds explicit cross-device favorite/unfavorite/removal coverage and upstream-rate countdown/queue-stop coverage. Keyboard checks now assert restored origin focus and placement-action focus without forcing focus to hide failures.

The four round-5 viewport/theme matrix sheets were actually opened and inspected, as was the round-3 landscape cleanup sheet. The landscape actions are fully visible in both phone engines. No rectangular transparency artifacts or image-box shadows were visible in those states; small grids remain scrollable inside their sheets. [Light Chromium](round-5/matrix-chromium-light.jpg), [dark Chromium](round-5/matrix-chromium-dark.jpg), [light WebKit](round-5/matrix-webkit-light.jpg), [dark WebKit](round-5/matrix-webkit-dark.jpg). The round-4 full-size ring/collage was also inspected before the final geometric hit-check cleanup.

Final commands are being recorded from fresh logs after all source fixes. The test web build uses `VITE_APP_VERSION=0.0.1`, as Playwright normally configures, so existing update-notice tests are meaningful even when a local preview process is reused. A manual unversioned build had temporarily disabled those notices in an earlier focused run; rebuilding with the test version resolved all four notice cases.

## Latest verification checkpoint — 2026-10-20

The previous goal turn made concrete progress: the new handle/arc concepts were delivered as an interactive comparison. They are optional ideation; the implemented control remains the user's requested circle until a replacement is chosen.

### Final command results

| Command | Observed result |
| --- | --- |
| `pnpm typecheck` | Passed all six package checks. |
| `pnpm test` | Passed 14 files / 160 tests. |
| `VITE_APP_VERSION=0.0.1 pnpm build` | Passed web, Tauri `.app`, and DMG builds. Earlier sandbox disk-device failure was resolved by the authorized unsandboxed build. |
| `CI=1 PERF=1 STICKER_VISUAL_ROUND=8 pnpm test:e2e --workers=4` | Exit 0: **434 passed, 1 flaky (passed on retry), 4 skipped** in 4.2 minutes. All sticker cases passed on their first attempt. Fresh CI servers avoided the stale desktop-preview process from the prior run. |
| `git diff --check` | Passed; rerun after this documentation consolidation. |

The four skips are the two Chromium-only performance tests on WebKit plus the opt-in README screenshot test on both desktop engines. They are not skipped sticker acceptance checks.

The one flaky case is the existing Chromium scoped image/file agent-proposal approval check: direct approval returned 409 on its first attempt and passed on the configured retry. The earlier null-content asset scan crash was fixed and explicitly covered by this test. The remaining approval response did not record its body, so its precise cause is **unproven**; the global access-revision guard can reject concurrent unrelated access changes, but this is an inference, not a diagnosed result. No assertion or product authorization guard was weakened to make this run pass.

Follow-up diagnostic: approval failures now include the response body in their assertion. `CI=1 pnpm test:e2e --grep 'image and file proposals' --repeat-each=6 --workers=4 --retries=0` passed **12/12** across both desktop engines in 50.1 seconds; the intermittent 409 did not recur, so its cause remains unproven. This changes test diagnostics only, not approval or authorization behavior. The latest private-value scan passed all 119 changed/untracked files; ignored `.dev.vars` remains mode 600. `git diff --check` passed after QA consolidation.

Final headless performance results: existing 1,000-card/300-image baseline pan p95 16.8 ms, overview 16.7 ms, 35 mounted detail cards, 11 MB JS heap; 500-sticker case overview p95 16.8 ms, detail 16.7 ms, 70 mounted detail stickers, 9 MB heap. Both measured p50 near 16.7 ms. This is browser/headless evidence, not a native GPU benchmark.

### Latest visual review

Actually opened and inspected all four round-8 viewport/theme contact sheets, all three state sheets, full-size light and dark selected-ring captures, the iPhone selected-ring capture, and the decoded format contact sheet. These are fresh captures from the passing full suite. The short-window and landscape previews keep their actions visible; portrait phone controls fit above the dock. Transparent art and silhouette shadows have no rectangular background. Tray grid clipping occurs only at its intentional scroll boundary. Selection chrome remains above overlapping artwork; ordinary note/photo/column layout remains independent.

- [Chromium light](round-8/matrix-chromium-light.jpg), [Chromium dark](round-8/matrix-chromium-dark.jpg), [WebKit light](round-8/matrix-webkit-light.jpg), [WebKit dark](round-8/matrix-webkit-dark.jpg)
- [Import, pairing, errors and placement](round-8/states-1.jpg), [touch and WebKit states](round-8/states-2.jpg), [remaining recovery/ghost states](round-8/states-3.jpg)
- [Populated selected collage](round-8/webkit-light-selected-ring.png), [iPhone](round-8/mobile-webkit-selected-ring.png), [Pixel](round-8/mobile-chromium-selected-ring.png)
- [Format inspection](formats/format-review.jpg): actual decoded TGS on both engines, Chromium VP9-alpha frame and WebKit transparent still. Pixel assertions in `sticker-formats.spec.ts` complement this visual evidence.

Duplicate round-7 captures and raw round-8 matrix frames were removed after review; the contact sheets and representative full-size states preserve a smaller reviewable evidence set. Earlier cleanup rounds remain linked above.

### Native observations and current blocker

User explicitly authorized controls for **DoggyNote Stickers QA**, bundle ID `dog.doggynote.stickersqa`. The freshly built isolated app used its own identity and local Worker, without modifying the ordinary installed DoggyNote app.

Observed with real native input on the circular-control build:

1. Dragging the circumference changed a real `hyenafox` sticker from size 180 / angle 13° to size 274 / angle 40° while keeping its center fixed.
2. Dragging the artwork moved it approximately 50 × 25 CSS pixels, retaining size 274 / angle 40°. Native screenshot coordinates were 2× logical coordinates.
3. Quit through Cmd-Q; a subsequent app inventory no longer listed the QA app. Relaunched the same isolated bundle, dismissed the unrelated update offer with Later, and observed the same moved position, size 274, and angle 40°. The undo stack reset on process restart, while persisted geometry remained.
4. Real static transparent artwork rendered cleanly against the native dark canvas at both tested sizes and angles.

Evidence: [native transform and move](native/radial-transform-and-move.png), [after actual quit/reopen](native/reopened-persisted-transform.png).

A subsequent tray drag was interrupted by a reported external UI change, so it is **not** claimed passed. The next native fixture-pack click stalled and was interrupted. A recovery helper reset the per-agent Computer Use MCP child; the one reinitialization attempt returned **Transport closed**. The dead connection was not retried. Native tray-to-canvas drag and native TGS/WEBM still-fallback inspection remain incomplete. Browser WebKit passing these cases is not substituted for native observation. Resuming those two checks requires a working native-control connection or a user walkthrough of the isolated QA app.

Routine web walkthroughs now use the built-in Paseo browser, which was opened at `http://localhost:8789`, signed into the disposable local `rex` account with explicit user authorization, and verified to show the imported collection. Playwright remains the cross-engine regression runner. Paseo's browser does not prove behavior in Tauri's native window.

Follow-up Paseo walkthrough opened the fixture's first paw and bone previews through ordinary controls and visually confirmed usable transparent stills. Its `browser_evaluate` tool was blocked by the app's `script-src 'self'` Content Security Policy; no policy was relaxed. Scripted per-pixel/playback assertions remain in Playwright. A transient local session sign-out required another authorized fixture sign-in; this was not treated as native or animation evidence.

Blocked audit: the native-control interruption, subsequent closed transport, and current continuation leave the same remaining native verification dependency unresolved. Independent browser checks, diagnostic improvements, final scans, curated screenshots and requirement audit are complete. A concise user walkthrough question is pending for native tray drag plus the first paw/bone previews; absent that evidence or a restored native provider, completion cannot be proved. The goal is blocked on this external verification, not marked complete.

Live external evidence remains [link import](live/result.json) and [confirmed bot import](live/pairing-result.json). The dedicated bot's real updates were polled and forwarded to the local authenticated handler; production deployment and public HTTPS webhook registration/delivery remain outside this local test and unverified. No bot replies were sent.

## Star Favorite action and native-tool recovery

User requested an icon for favoriting a sticker. The enlarged preview now uses the existing outlined star drawing in an icon button; a favorited sticker fills the star with the theme accent. Favorite/Unfavorite accessible names, tooltip, `aria-pressed`, keyboard behavior and the 44px touch target remain. The Favorites collection tab keeps its readable navigation label.

After this change: `pnpm typecheck` passed; `pnpm test` passed 14 files / 160 tests; `VITE_APP_VERSION=0.0.1 pnpm build` passed the app and DMG; the focused desktop/touch/import/favorite/visual/export E2E run passed **10/10** in 56.2 seconds. Actually inspected fresh [WebKit desktop preview](round-9/webkit-light-600x720-preview.png), [Chromium phone preview](round-9/chromium-dark-390x844-preview.png), and [iPhone landscape preview](round-9/mobile-webkit-landscape-preview.png). The icon is visible, actions fit, and the same accessible button names continue to exercise favorite/unfavorite and cross-device state in the existing functional tests.

User chose native-tool recovery rather than a manual walkthrough. Local CLI help exposes `paseo agent reload <id>` to restart one agent's underlying process. Recovery is scoped to this agent `3a8c8eae-8a9d-4f73-9b91-d0e98b0e7f13`; no daemon-wide restart or permission-mode changes are intended. A supervised recovery terminal will reload this agent and send its saved continuation instructions back to the same agent. Native checks remain unverified until the recovered connection actually completes them.

Recovery result: the supported per-agent reload completed and the CUA transport responded again. Its single initialization attempt was denied with **“Computer Use was not approved to use DoggyNote Stickers QA”**, without further reason. The user then reiterated the Paseo-browser preference and objected to more native approval prompts. No further native-control calls or approval questions will be made. The prior native move/transform/close-reopen evidence remains valid; remaining native tray-drag and format/fallback checks stay explicitly unverified. The star UI is being given its final complete command-line browser regression run.

## Final browser verification after the star change

`CI=1 PERF=1 pnpm test:e2e --workers=4` exited 0: **435 passed, 4 intentional skips, no retries or failures**, in 4.8 minutes. This includes desktop Chromium/WebKit, iPhone/Pixel touch, iPad touch, the existing performance baseline and 500-sticker performance case. The formerly intermittent proposal test passed on both engines in this complete run. Its historical unproven 409 cause remains documented; no retry or assertion was added to conceal it.

The latest complete run regenerated default-round captures. Retained and actually inspected five representative final frames in round 10: [populated selected collage](round-10/webkit-decorated-selected.png), [bot import entry](round-10/chromium-bot-pairing.png), [phone star preview](round-10/webkit-light-390x844-preview.png), [landscape star preview](round-10/mobile-webkit-landscape-preview.png), [Pixel circle controls](round-10/mobile-chromium-selected-ring.png). Extra raw frames were removed. These complement the earlier round-8 full theme/viewport contact sheets and round-9 icon review; the early round-1 contact sheets remain intact.

In the authenticated Paseo browser, clicked the new star and inspected the filled result: the button switched from Favorite / `aria-pressed=false` to Unfavorite / `aria-pressed=true`. The local Worker now runs in the supervised **DoggyNote QA server** terminal, retaining its existing test database/configuration. Health returned 200 and the authenticated imported collection reloaded successfully after the agent restart.

All required command checks pass on the latest implementation: typecheck, 160 unit/integration tests, app+DMG build, complete E2E and diff check. Goal completion is still **unproven** solely for the two native-only checks called out in the audit. Public HTTPS webhook delivery is also explicitly unverified; genuine Telegram import/pairing through the local handler already passed. Local changes remain uncommitted and reviewable. No production deployment was performed.

## Artwork-first UX review and final verification

Completed the user's new tray/preview design and QA round. Removed every per-sticker Preview button and the header tagline. Preview opens through hold, right-click, Space or Shift+F10. Its real source pack title is one navigation row; Place sticker and the star have a dedicated bottom action row. Source-pack navigation remembers the collection return route. See [design decisions, Telegram research, findings and fixes](ux-review-2026-10-20.md).

The initial round-11 redesign run passed 29 and failed two landscape touch checks. Round 12's compact landscape layout fixed clipped targeting on WebKit, but Chromium still armed placement after a hold. A real event trace proved the held tile unmounted and its release click landed on the newly mounted Place button. The root capture guard now consumes that trailing click and clears on the next deliberate press or keyboard action. The phone regression verifies no armed/committed placement on release and successful Place on the next tap. Six focused contextual/keyboard/phone cases passed with retries disabled.

Latest required checks, on the final redesign:

- `pnpm typecheck`: pass across packages.
- `pnpm test`: 14 files / **160 tests passed**.
- `CI=1 PERF=1 STICKER_VISUAL_ROUND=16 pnpm test:e2e --workers=4`: exit 0, **437 passed / 4 intentional skips**, no retries or failures, 4.7 minutes.
- `VITE_APP_VERSION=0.0.1 pnpm build`: exit 0, web plus desktop app and DMG built. Existing `.app` bundle-identifier warning remains.

Actually inspected the [first redesign review](round-11/review.jpg), [landscape cleanup review](round-12/review.jpg), all four final round-16 matrix sheets, the final recovery/import state sheet, the passing landscape preview, and the readable [artwork/preview comparison](round-16/artwork-and-preview.jpg). Final sheets: [WebKit light](round-16/matrix-webkit-light.jpg), [WebKit dark](round-16/matrix-webkit-dark.jpg), [Chromium light](round-16/matrix-chromium-light.jpg), [Chromium dark](round-16/matrix-chromium-dark.jpg), [import/recovery states](round-16/states.jpg). Full-size examples: [desktop preview](round-16/webkit-dark-1024x768-preview.png), [portrait phone](round-16/webkit-light-360x740-preview.png), [landscape phone](round-16/mobile-webkit-landscape-preview.png). Extra raw frames were removed after review.

The Paseo browser showed the actual hyenafox artwork-only grid and enlarged preview with a real pack title; Favorite changed to Unfavorite/pressed. A fresh resident tab was used after the older tab stopped dispatching interactions following reload. In that fresh tab, source navigation opened the real 34/34 pack with Your collection as the return route. No CSP changes, native controls, or native approval prompts were used. Browser WebKit remains distinct from native Tauri evidence.

Hosting plan is documented in [configuration](configuration.md): existing Cloudflare Worker webhook, D1 pairing state and R2 bytes; deployment, migration, secrets and HTTPS webhook registration are still to be performed. Local polling was QA infrastructure only. Public webhook delivery and the two previously documented native-only checks remain unverified. This UX round does not mark the original goal complete.

Final hygiene: `git diff --check` passed; private-value scan passed all 141 changed/untracked files, ignored secrets remained mode 600, and QA relative links resolved. No secrets were printed. Local changes remain uncommitted for review.

## Bot acknowledgements, randomized dog copy and release preparation

Continued the existing goal after user feedback to keep working. Added user-initiated pairing/import/recovery replies through Telegram's documented webhook JSON response method. Each of six reply categories has three dog-themed variants in `COPY.telegramBot`, selected randomly only after a fresh update commits. The server now depends on the existing local theme package; no external package was added for copy selection.

Pairing still requires explicit authenticated app confirmation. Replies never add a pack or place a sticker. The replay marker and state effects commit in the same D1 batch before any reply payload is returned. Replayed updates and unchanged pending pack/notice sends stay quiet. Unknown text, groups, bot senders, mismatched chats and invalid IDs produce no acknowledgement; unauthorized webhook requests are rejected. App state remains authoritative because webhook-response message delivery is best effort.

Added two server integration cases covering reply stages, random variation with controlled random inputs, private-chat scope, no automatic pairing/import, disconnect/expiration/forwarded-link recovery, replay and repeated-send suppression, and absence of outgoing fetches. Extended the actual Chromium/WebKit pairing flow to assert acknowledgement payloads and silent retries. The first focused invocation used a nonmatching test selector and ran no tests; the corrected selector passed both cases with retries disabled.

Current checks: `pnpm typecheck` passed; `pnpm test` passed 14 files / 162 tests; focused pairing E2E passed 2/2. `wrangler deploy --dry-run --env-file /tmp/stickers-release-empty.env --outdir /tmp/stickers-worker-release` passed on the final bot implementation. It used no bot credentials and made no deployment. The existing wrangler/workers-types peer warning remains; no dependency versions were changed to suppress it.

Rebuilt the isolated `DoggyNote Stickers QA.app` with the final artwork-first UI and current shared copy, using its own frontend output directory, bundle ID `dog.doggynote.stickersqa`, web token store and local API on 8789. Build exited 0, and the bundled Info.plist confirmed the isolated identity. No native controls or native approval prompts were used, and this build is not a native interaction pass.

Paseo's existing local QA tab still shows the actual connected test identity and pending pack through ordinary controls. That read-only walkthrough preserved pairing/collection state. Fixture tests inspect reply JSON locally; no new real Telegram messages were sent, no webhook was registered, and no public acknowledgement delivery is claimed.

Prepared [release readiness](release-readiness.md), including the response/state matrix, existing coordinated migration/desktop/web release path, secret handling and hosted smoke-test sequence. Publication remains explicitly outside the original goal. Final complete browser regression and packaging are being completed on this latest implementation; native-only checks remain open.


The first full bot-copy regression exited 0 with **436 passed, 1 flaky pass on retry, 4 intentional skips** (4.9 minutes). The flaky case was the existing Chromium Fetch keyboard/short-window geometry check, which threw on a null bounding box. Its selected-option/list bounds were read in separate calls with non-null assertions. The poll now samples the selected option and list geometry together in one DOM read, retries missing geometry, and retains the full visibility/vertical-containment assertion. This changes test measurement only; no Fetch product behavior or assertion threshold was relaxed. The exact cause of the transient missing box is not proven from the failure snapshot. Repeated focused verification and final results follow below.


The corrected Fetch geometry test passed **12/12** repeated cases on Chromium/WebKit with retries disabled (`CI=1 pnpm test:e2e --grep 'Fetch aligns supporting text' --repeat-each=6 --workers=4 --retries=0`, 45.4 seconds). `VITE_APP_VERSION=0.0.1 pnpm build` also exited 0 for web, desktop app and DMG. The final complete suite is running with retries disabled after this test-only change; product behavior remains unchanged.


Final strict verification: `CI=1 PERF=1 STICKER_VISUAL_ROUND=19 pnpm test:e2e --workers=4 --retries=0` exited 0: **437 passed, 4 intentional skips, no failures**, in 4.7 minutes. Fetch passed on both engines with the atomic measurement; the historical transient null-box cause remains unproven. No retry allowance or product behavior was changed to conceal it.

Actually inspected the final fresh [desktop preview](round-19/webkit-dark-1024x768-preview.png), [portrait phone preview](round-19/webkit-light-360x740-preview.png) and [landscape phone preview](round-19/mobile-webkit-landscape-preview.png), plus the corresponding retained round-18 frames from the earlier bot run. Current UI retains clean artwork, source navigation and stable Place/star actions. Extra raw frames were removed after review; full round-16 theme/viewport and recovery evidence remains available because this follow-up changes bot copy/handler behavior and test measurement, not sticker layout.

The local delivery is ready for review. The two native-only interaction checks remain incomplete under the existing native-control denial; rebuilding the isolated app is not substituted for observation. Public webhook registration/delivery and publication remain outside this local goal, with exact enabling steps in the release-readiness guide. No new real Telegram message, deployment, webhook registration or production migration was performed.


Final hygiene passed: private values absent from 151 changed/untracked files; private configuration remains mode 600; QA relative links resolve; git diff whitespace check passes.


## Delegated native verification requested by the user

The user requested a subagent whose scoped permission requests the parent can approve. Created Paseo child `04fb8f3f-f0c5-4d10-8112-8eca94203a56` (Native sticker QA: drag and transparent previews), in this workspace, using ordinary default permissions with finish/permission notifications enabled. No bypass/full-access mode was selected. The parent will handle only requests within the existing authorization for DoggyNote Stickers QA and local disposable QA sign-in. The fresh child is assigned the two still-open native checks, with no deployment, messaging, secret access or ordinary DoggyNote controls. A fresh native initialization attempt is permitted; another denial or dead transport must be reported rather than retried in a loop. Results remain incomplete until actual evidence is reviewed.

Parent received the child's actual Computer Use permission request for DoggyNote Stickers QA through Paseo and approved that scoped request (`permission-5c07a23d-d79d-44f7-9f07-fc1187331b12`). The child reports that the isolated native connection succeeded and is relaunching the freshly built bundle before testing. A separate request to send progress to the parent was approved as part of this delegation. No permission mode was loosened and no ordinary app control was authorized. Native results are still pending.

Delegated native verification found and diagnosed a local QA setup failure: `/api/assets/token` returned 500 (image tokens not configured), and native cross-origin image URLs consequently returned401 despite correct CORS. The supervised QA Worker had been restarted earlier without its asset-token signing binding. Restored that value privately in ignored mode-600 `.dev.vars`, preserved all existing bot values and the persisted database, and restarted only Worker8789 in the same supervised terminal. A disposable-account diagnostic then returned token200 and image200 for hyenafox, Doggy daydreams and Spotted Hyena with correct types/byte counts/CORS. No secret value was printed. Added the blank asset-token setting to `.dev.vars.example` to make local desktop setup reproducible. Native artwork review resumes after remounting/restarting failed-image components. This is a corrected local configuration failure, not a native rendering pass.


## Delegated native result and mobile shelf follow-up

Read the child's [native follow-up](native-subagent-review.md) and actually inspected its pink-paw preview, green-bone preview and placed-bone PNGs. Their silhouette transparency is clear; dotted canvas shows around the placed bone without an opaque rectangle. Both native tray drag attempts instead armed click-to-place and committed zero objects, so exactly-one drag commit remains unverified. The child's final screenshot call returned `cgWindowNotFound`; native actions stopped. This is a specific remaining verification issue, not a claim that all native controls are disconnected. Parent handled the scoped requests through the [Paseo skill](/Users/oreo/.agents/skills/paseo/SKILL.md), without permission-mode changes.

The user then requested trying a mobile sticker button at bottom right that opens a compact sticker slot for browsing and dragging onto the board. Implemented a mobile-only thumb target above the dock, a horizontal collection shelf with pack tabs/search, independent horizontal position memory per pack, and upward touch drag with an offset ghost. Sideways movement browses; holding still previews; tap-to-place stays available. Desktop and tablet grids retain their existing layout. Removed stale pairing text claiming the bot would not reply, now that acknowledgements exist. Verification and inspected captures follow after this prototype's checks.

The first post-copy full run could not bind localhost under the sandbox (`listen EPERM ::1:5175`); its approved outside-sandbox restart was interrupted when the user added the mobile prototype. That interrupted run left its own test servers alive. Verified their exact PIDs and workspace working directories, then stopped only those test servers (5175/8788/4174/5180). The supervised QA Worker8789 and native app were retained. A fresh mobile-focused run uses fresh test state.

## Mobile shelf regression review

The first completed full run on the shelf/landscape fix exited 1: **436 passed, 3 failed, 4 intentional skips** (`/tmp/stickers-mobile-shelf-final-e2e2.log`). All sticker cases passed. The three failures were preserved and addressed rather than accepted as a green full run:

- Scoped-assets agent approval returned409 with the newly recorded body `Revision conflict`. The API fixture was staged before its image/file cards rendered. Source review found `layout.ts` queues height writes for400ms; `waitForSync` can be idle before that debounce fires. Reload/render the fixture and wait until actual measured heights exist on the server before creating the revision-bound proposal. This preserves the 200 approval and cross-scope rejection assertions; no stale proposal auto-approval/retry was added. The delayed layout write is the supported explanation, rather than a claim that the earlier historical conflict's cause was previously proven.
- Phone WebKit's fixed550ms hold selected the card but did not move it. The test now holds actual touch input until the visible selected state confirms lift, then sends the same70/30 movement and retains the >50 displacement assertion. The original scheduler/input timing was not traced, so its precise cause remains unproven.
- Phone Chromium child-board setup used a raw sync POST and recorded only a false `ok`, with no response body. It now uses the existing bounded409 fixture helper and includes the response body if it fails. The original response code/cause was not captured and is not retroactively claimed.

The three cases and both sticker phone flows passed **27/27 repeated cases**, retries disabled, in56.1s (`/tmp/stickers-mobile-shelf-repeat.log`). Removed the launcher's generic `icon-btn` class after screenshots showed inherited pressed styling dimming its icon; the dedicated button styles now render clear theme-accent feedback. Actually inspected fresh round-24 light WebKit and dark Chromium shelf screenshots, both with clear launcher icons. A complete final run follows on this exact implementation.

The preceding full run was deliberately interrupted after276 passes when the landscape collision fix superseded its served build; exit130, four in-flight cases interrupted, not a pass. Sent SIGINT only to the verified Playwright runner so its managed servers cleaned up. No product behavior was changed to make unrelated tests pass.

The Paseo browser tab was resized to390×844 and navigated to the local QA board on8789. Its snapshot exposes the new launcher, but click/key input did not change state and screenshot returned `The tab has not painted yet`. No successful Paseo-browser visual/input pass is claimed for this attempt; no host restart, CSP weakening or repeated recovery loop was used. Current phone input evidence is the real Chromium touch and WebKit touch-helper suites and their inspected captures.


## Final mobile shelf checkpoint

The latest source passed all required commands after the touch-preview center correction:

- `pnpm typecheck` — pass (`/tmp/stickers-mobile-shelf-final-typecheck.log`).
- `pnpm test` — **14 files /162 tests**, pass (`/tmp/stickers-mobile-shelf-final-unit.log`).
- `VITE_APP_VERSION=0.0.1 pnpm build` — web, desktop app and DMG, pass (`/tmp/stickers-mobile-shelf-final-build4.log`).
- `CI=1 PERF=1 STICKER_VISUAL_ROUND=26 pnpm test:e2e --workers=4 --retries=0` — **439 passed, four intentional skips, no retries or failures**, exit0 in4.9min (`/tmp/stickers-mobile-shelf-final-e2e4.log`). Includes both phone engines' sideways browsing, one-shot upward drag, cancellation, preserved position, exact lifted/committed-center match, and landscape Favorite action. Existing permission/share/export/format/sync/undo and performance coverage also passed.
- Earlier repeated affected cases —27/27, retries0; exact command and failure analysis above. The final run also exercises the settled-height fixture wait.

Actually inspected eight fresh final states: [light phone shelf](round-26/mobile-webkit-light-sticker-shelf.png), [dark phone shelf](round-26/mobile-chromium-dark-sticker-shelf.png), [landscape shelf](round-26/mobile-chromium-landscape-tray.png), [landscape preview/star](round-26/mobile-webkit-landscape-preview.png), [lifted ghost](round-26/mobile-webkit-shelf-drag-ghost.png), [360px shelf](round-26/webkit-light-360x740-tray.png), [360px preview](round-26/webkit-light-360x740-preview.png), [desktop preview/collage](round-26/webkit-dark-1024x768-preview.png). Layout, artwork transparency, clear launcher feedback and unobstructed actions are acceptable. Retained a small curated set; superseded raw duplicate frames were removed.

[Verification manifest](mobile-shelf-verification.json) records the checked mobile source/test hashes. The separately authorized shared-board discovery task was moved by its parent to another worktree before this run completed; no discovery product/test patches were applied here. Its goal/QA documents are preserved as separate work.

The original goal remains incomplete only for native exactly-one tray drag verification. The new mobile flow's browser pass is not relabeled as native evidence. The [native report](native-subagent-review.md) preserves both zero-commit attempts and the later missing-window error; a working native drag input path is needed to resolve it. Hosted bot acknowledgment delivery still needs an explicitly authorized HTTPS deployment/webhook smoke test, which is outside this local publication scope. No deployment, webhook registration or Telegram message was performed.


Final hygiene after curation: secret-value scan passed for181 changed/untracked files; private configuration mode600; QA relative links resolve; verified source hashes are unchanged; `git diff --check` passes. No product source was edited after the final439-test run.


## User waiver and hosted-bot next step

The user explicitly said “We can skip 1” referring to native tray-drag verification. Record it as waived/unverified, not passed; it no longer blocks acceptance. The user asked how to perform hosted Telegram verification. No hosted secret update, deployment, production migration, webhook registration or outgoing Telegram message has been authorized/performed by that question. The existing Worker can host the handler; the next plan must specify the intended deployed environment and real end-to-end test.

## Authorized hosted Telegram QA

The user's following “Sweet, let’s do it” authorized the explained isolated test-first plan. Created and deployed only `doggynote-stickers-qa`, its own database and asset bucket, a private random-password non-admin account and independent hosted signing/webhook secrets. Verified the token's bot username and absence of any existing webhook before registering the dedicated test bot to the healthy QA HTTPS endpoint. Telegram's three queued updates drained without dropping them; latest status reports zero pending updates and no delivery errors. Real Paseo browser input signed in and opened the fresh connection screen. The user has been asked to press Start, observe the reply, confirm the account in the app and send a hyenafox sticker. Those human/live stages remain pending. No production deployment, migration, merge or updater publication was performed. Exact resource/version information and sanitized evidence are in [hosted QA](hosted/README.md).

The hosted walkthrough subsequently passed. The user confirmed both dog-themed replies were received; actual app state showed the explicitly connected account and the real `miniswizzyeen` suggestion. Preview reached96/96 ready with zero failed preparations and no collection membership until explicit Add. The agent inspected/captured the hosted preview, clicked Add through Paseo and confirmed exactly one96-sticker collection with zero board stickers. Two repeated HTTP submissions with a processed real update ID returned only `ok`, changed no connection/pending state and requested no repeat reply. Latest webhook pending count is zero with no error. See hosted screenshots/reports for exact bounds of these claims.

The next user request is an intentional visual cleanup of the Telegram connection, pack-add and pack-preview layouts. Finish the current test first (done), update visuals and deploy to the isolated QA environment, then rely on the user for the refreshed manual walkthrough. Do not repeat native control attempts or silently reuse pre-cleanup captures as proof of the updated UI.

## Import-flow redesign handed to the user

The redesigned Add pack, Telegram and pack-preview screens passed the full suite (one unrelated Fetch test race fixed in the test), the sticker specs after two further fixes (phone-landscape detail spacing; no false "no packs" state while loading), typecheck and unit tests. Seven inspected captures are kept in [round-28](round-28/). The isolated QA Worker now runs version `01cc968d`; hosted pairing and the 96-sticker pack are intact. The user's manual review is pending. Details: [design record](import-flow-design.md). No production deployment, Telegram interaction or native session was performed.

User round 1 on the redesign: compact Disconnect, pack titles on suggestions, load steps of 3, a subtle hard top-left sticker shadow, and a Stickers badge plus one-click "Pack found" card. Full suite green (443 passed, 4 intentional skips). QA Worker `67a3811b`; manual review pending. Details: [design record](import-flow-design.md).

User round 2: multiple sent packs as compact rows (tray, Add pack, Telegram screen) with real titles from the start, background preparation with progress rings, preview anytime, drag-to-front, and no grid resizing during loads. Migration 0011 (QA database only). QA Worker `c1af5bd0`; manual review pending. Details: [design record](import-flow-design.md).

User round 3: add from the list (plus icon), eye icon for preview, a pinnable tray that stays open while placing, and a white die-cut border on every sticker. QA Worker `cc5ff8c3`. Details: [design record](import-flow-design.md).

User round 4: no loading line when previewing, immediate pin feedback, a crisp die-cut border, an icon-only sticker bar (labelled bottom sheet on phones), and no size/angle fields: the ring turns and resizes (arrow keys too) with a reset-rotation button beside it. QA Worker `bc4ad37f`. Details: [design record](import-flow-design.md).

User round 5: an unpinned tray closes on a click on empty board; reset restores size as well as rotation; several selected stickers share one ring that turns and scales them together; grabbing any selected sticker or card moves the whole selection. The group ring is the smallest circle around the stickers. QA Worker `c844279a`; manual review pending. Details: [design record](import-flow-design.md).
