# Stationary photo editor and account-header review

Date: 2026-11-03. This refinement supersedes the interaction and account-header approval recorded by the earlier profile-photo implementation.

## First critique

Two isolated Impeccable assessments reviewed the approved direction. Assessment A completed before detector/Assessment B findings entered the primary agent's synthesis. Both used fresh automated browser contexts; neither saved or removed the manual test account's photo. The user's supplied screenshots and feedback against the previous implementation outranked the previous ship verdict.

- [Design assessment](stationary-critique-design.md): 32/40 before corrections; core stationary-image model and balanced account identity verified. P1: tiny panorama crop had an unusable movement target and collapsed corner marks. P2: Chromium crop focus outline clipped at the bottom. P3: transparency was not recognizable.
- [Technical assessment](stationary-critique-mechanical.md): P1: actual file-picker opening did not focus the editor. It independently confirmed the tiny movement target. Photo pixels, crop direction, touch isolation, corner target separation, footer and nested Escape behavior passed.
- [Single detector scan](stationary-detector.json): no source findings. Captured browser overlays flagged the existing empty-canvas contrast and canvas zoom control, outside this feature. No second scan was run.

The complete first-review matrix is `stationary-round-1/`: Chromium/WebKit, both themes, five viewport sizes, eight states and three additional source-shape cases at desktop/narrow sizes. The first capture attempt reused a saved photo between viewports; it was replaced with captures that reset each empty-photo state before review. Historical older folders are not final evidence.

## Batched corrections

| Finding | Correction | Verification |
| --- | --- | --- |
| Tiny crop cannot be grabbed on touch | Conditional labelled 44px Move crop grip with a leader to the true crop; collision-free placement outside selection and four resize targets. Minimum preview 224px. Image remains fixed. | Geometry tests and iPhone/Pixel touch cases at 320×480 with a 2400×200 source; source-shape capture checks. |
| Tiny corner marks overlap | Scale glyph lengths and strokes with selection size, retaining true crop coordinates. | Panorama/portrait minimum-crop captures. |
| Keyboard outline clips | Draw the stage focus outline inward. | Chromium framed state at desktop and short-window sizes. |
| Opening editor leaves focus outside | Focus Close photo editor on mount with preventScroll, retaining modal containment. | Actual-picker helper asserts immediate focus on every upload flow. |
| Transparency reads as solid fill | Quiet theme-token checkerboard clipped to source bounds, behind the preview canvas only. | Transparent-source captures and saved PNG corner-alpha assertions. |
| Generic popover would wrap Tab internally | Explicit Tab returns to Appearance; Shift+Tab returns to avatar. | Nested menu keyboard regression case, alongside two-stage Escape. |

All four resize targets stay 44px and disjoint; the tiny-selection grip adds one conditional movement control rather than a new toolbar or background zoom. Existing authenticated storage APIs, migration, image export and privacy rules were not changed by this refinement.

## Final evidence and result

The corrected capture matrix is `stationary-final/`. The first fresh finish review returned ship after the documentation correction, then that verdict was superseded when an actual visible-corner hit test exposed a functional mismatch. The [current finish report](stationary-finish-review.md) returns **ship** after rechecking the corrected source, all 184 refreshed captures, visible-mark regressions and final documentation. The [documentation check](stationary-documentation-check.md) confirms the narrow design-system update. Review uses exact viewport screenshots, source fingerprints and interaction tests, without native computer-control requests. Browser emulation does not claim physical-device coverage.

Questions skipped: the approved implementation scope already requires resolving material review findings autonomously; no new product-direction decision was required.


## Visible-corner gate and fallback clarity

A real pointer check on the white top-left corner arm hit the movable selection instead of the resize button. The marks were painted beyond their outward targets. This invalidated the previous ship disposition. The correction now insets each 44px target enough to contain its painted mark, with proportional inset/arms preserving separation for tiny crops. The movement-grip placement uses the same target rectangles.

A new regression hit-tests and drags the visible arm at all four corners in Chromium and WebKit. Both pass; before the correction the same local drag left zoom at 1.25, afterwards both engines reached 1.4272. Geometry tests also verify every painted arm remains within its own disjoint target. Evidence: [visible-mark verification](stationary-visible-mark-verification.json).

The user's “What is the move button for???” question exposed insufficient label clarity. The existing conditional grip now visibly says **Move crop**, with its leader retained; ordinary-sized selections remain directly draggable with no extra control. No background zoom or auto-reframing was introduced.

All 184 final screenshots and six source fingerprints were refreshed after this batch. Twenty-four corrected-bundle cases passed on the first run. Two presence cases encountered the full suite's accumulated rex board set during viewer startup; using dedicated observer accounts made both pass without changing application behavior. The complete unit suite now passes 442 cases.

## Completion checks

Workspace typecheck, 442 unit/integration cases, 24 final fresh-data browser checks and production build (including Mac app/DMG packaging) passed. Four additional capture cases generated the 184 final PNGs. The full regression result and reruns are recorded in [regression results](stationary-regression-results.md); the original full run was not clean and predates the late corner correction. The current independent finish verdict is ship. User dev servers remain available at http://127.0.0.1:5173; no native interaction, deployment or commit was performed.
