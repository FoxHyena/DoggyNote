# Profile photos QA

Date: 2026-11-03. The latest implementation is the **stationary-photo editor and camera-based account header**. It supersedes the older slider/corner-crop interaction approvals. The independent browser-surface finish review returned **ship** after the visible-corner regression correction. See [stationary finish review](stationary-finish-review.md); first-review findings and corrections are in [stationary review](stationary-review.md).

Latest user correction: the camera is now **hover-only**. Four desktop/phone browser checks passed; see [follow-up verification](hover-only/verification.md). The earlier full matrix and finish review precede this small CSS change.

## Current behavior

Account uses a balanced avatar-and-username header. The avatar camera opens Add photo, or Change photo / Remove photo. The camera appears only on mouse hover, including for empty photos; keyboard focus, open-menu state and touch do not reveal it. The labelled avatar remains keyboard- and touch-operable. The desktop popover is 280px wide; identity uses a 56px avatar, 16px padding/gap and centred 15px semibold username. The existing phone sheet and account actions remain. Photo options stay a small anchored menu on phones. Escape closes options before Account; Tab returns to Appearance and Shift+Tab to the avatar. Picker cancellation preserves Account. Closing or saving the editor returns to the account avatar with focus.

JPEG, PNG and WebP sources up to 15 MB open a local editor. The entire oriented photograph remains stationary and visible. A centred 80% square with circular guide moves and resizes over it. Drag within the selection or use arrow keys to move it; outside dragging does nothing. Corners anchor the opposite corner, within the existing 25–100% source-size limits. Spreading fingers enlarges the selection; two-finger movement translates it. Reset restores the initial selection. There is no visible zoom slider, image pan/zoom or automatic preview reframing.

Four outward 44px targets remain disjoint. When a selection is smaller than 44px, a conditional labelled Move crop grip and leader provide an accessible movement target without changing the image or selection. Tiny corner glyphs scale down to avoid crossing. A quiet checkerboard behind source bounds identifies transparency. The stage focus ring stays inside its boundary, the editor receives focus immediately, and the scrolling body keeps Cancel/Save reachable.

Save exports a 512×512 PNG, preserving transparency. The original is not uploaded. Saving errors retain the crop and previous picture. Shared circular avatars fall back to coloured initials for absent or failed images. Photos appear in Account, live people and shared-board attribution, with names and permission labels retained.

The existing server validates bounded PNG structure, checksums, dimensions and decompressed raster before R2 storage. D1 publishes the unique image pointer before cleanup and acknowledgement. Session/bearer and session-bound desktop image tokens work; anonymous and share-link credentials are rejected. The refinement changes no API, schema, storage or privacy behavior. Migration `0019_avatars.sql` belongs to the original feature and must precede its updated server release. No deployment was performed.

## Current review evidence

**`stationary-final/` records the reviewed crop/account refinement before the subsequent hover-only camera adjustment**: [184 exact-viewport PNGs with source fingerprints](stationary-final/capture-inventory.json), 22 contacts and seven canonical samples under `apps/web/.impeccable/review/profile-photos-stationary/`.

The main matrix covers Chromium and WebKit, dark/light, desktop 1440×900, tablet 768×720, phone 393×659, narrow 320×568 and short 720×480, across account/options-empty/crop/framed/saving/error/saved/options-saved. Supplemental portrait, 12:1 panorama and transparent sources cover desktop and 320×480 in both themes and engines. Every PNG header was checked against its requested viewport; the supplemental WebKit captures were replaced at DPR 1 before review. Six source hashes bind the matrix to the implementation.

Two isolated first assessments found a tiny touch movement target, overlapping tiny glyphs, a clipped keyboard outline, missing initial modal focus and unclear transparency. The correction batch resolved those and added explicit menu Tab exit. See [design assessment](stationary-critique-design.md), [technical assessment](stationary-critique-mechanical.md), and [resolution record](stationary-review.md). The single refinement [detector scan](stationary-detector.json) returned no findings. Browser overlays only identified existing empty-canvas text/zoom-control findings outside this feature. No second detector was run.

The independent finish reviewer previously approved the corrected visual flow, then reopened approval after a visible-corner hit test exposed a resize mismatch. Corner targets now contain their painted marks; both-engine actual-mark regressions pass. The reviewer reverified all refreshed screenshots, six source hashes, visible-mark interaction evidence and final documentation before returning ship. The canonical final disposition is recorded separately in [stationary finish review](stationary-finish-review.md), with a narrow [documentation check](stationary-documentation-check.md).

## CI follow-up

The first PR run exposed a Linux WebKit pixel-oracle mismatch. The expected crop now uses the same PNG encode/decode stage as the downloaded image while retaining exact full-image SHA comparison. See [root cause and verification](ci-png-roundtrip.md).

## Verification

| Check | Latest result |
| --- | --- |
| Workspace typecheck | Pass |
| Unit/integration suite | 626 passed in 59 files after rebasing onto current main |
| Focused browser checks | 24 final fresh-data production-browser checks passed again after rebasing onto current main, including both engines, phone emulation and desktop bearer/image-token access. Four capture cases also passed, producing 184 final screenshots. Includes all four visible-corner drags in both engines. |
| Full browser regression suite | 1,226 passed, 13 flaky, 17 skipped, 18 failed. Fresh-data rerun: 17 passed, 1 skipped. See [regression details](stationary-regression-results.md); full run predates the late corner fix. |
| Production build | Pass, including Mac app and disk image packaging; no native interaction run |
| Diff whitespace check | Pass |

Tests assert unchanged preview canvas pixels during drag, resize and pinch; full saved-crop pixel SHA agreement; bounds and immediate reversal; all corner anchors; reset/resize stability; touch access for tiny panorama selections; alpha preservation; actual-picker initial focus; menu hover/focus/Tab/Escape; picker/editor cancellation; long username layout; upload/removal retry; reload persistence; presence/attribution; and desktop bearer/image-token access. Mobile Chromium uses real CDP touch events; WebKit uses synthetic pointer events because Playwright lacks equivalent touch dispatch. No physical-device coverage is claimed.

At the user's request, verification stays in automated browsers. The wrapper compiled during the original feature work, but no native interaction coverage is claimed. Manual dev servers remain on `http://127.0.0.1:5173` with isolated local data; the full suite uses its own ports/data.

Reproduction:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm --filter web exec playwright test avatars.spec.ts mobile-avatars.spec.ts desktop.spec.ts theme.spec.ts --grep 'profile|photo|appearance' --workers=2
AVATAR_REVIEW=stationary-final pnpm --filter web exec playwright test avatar-review.spec.ts --workers=2
E2E_PORT_OFFSET=180 E2E_PERSIST_DIR=/private/tmp/doggynote-avatar-refinement-full pnpm --filter web exec playwright test --workers=4 --retries=1
```

Capture commands regenerate QA artifacts. The full-suite command initializes fresh isolated test data.

## PR integration verification

Rebased cleanly onto current main `fb636b1a`, including the table feature. Workspace typecheck (13 published docs), 626 unit/integration tests across 59 files, and all 24 focused production-browser checks passed on the integrated branch. These browser checks include the user's hover-only camera correction. Earlier screenshot source fingerprints and the full-suite run describe their earlier snapshots; the entire expanded suite was not rerun after integrating main. CI will cover the proposed branch. Production packaging after integration is recorded in the PR.

## Historical feature verification

`round-1/` and `round-2/` show the initial slider-based design and footer/error corrections. `corner-crop/` shows the superseded corner-resize version that still moved the photograph. `finish-review.md` and `documentation-check.md` record that earlier feature pass; they are not approval of the current refinement. `stationary-round-1/` records the first critique of this refinement before the correction batch.

The original feature had 438 passing unit tests, 14 passing final focused browser checks, typecheck and a production build including Mac app/disk image. Its full suite ran 1,264 cases: 1,230 passed, 14 skipped and 20 failed. Targeted reruns passed 17; two keyboard readiness/navigation failures were corrected and passed. The remaining WebKit 500-sticker relative-jitter assertion also failed on untouched baseline `db5a70f37627fc6d7c22201b6d577c9b620e52c3`: p95 14 ms exceeded the relative 12.5 ms limit while remaining below the absolute 33.4 ms budget. That earlier suite was not reported green. The new full-suite result is recorded above separately.

Pre-existing sidecar narrative drift, compact standard-avatar initials and unrelated orphaned briefs remain outside this refinement. No production deployment, commit, or native computer-control walkthrough was performed.
