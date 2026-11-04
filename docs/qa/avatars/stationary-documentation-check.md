# Stationary profile photos documentation check

Date: 2026-11-03
Disposition: complete; narrow refresh within the existing Warm Den system.

## Source and authority checked

Read the shipped `impeccable_documenter` definition and `reference/document.md`, `apps/web/DESIGN.md`, `apps/web/PRODUCT.md`, the updated profile-photo surface contract, and the incumbent `.impeccable/design.json`. Checked `AvatarEditor.tsx`, `AccountMenu.tsx`, `avatar.css`, `avatarCrop.ts`, `navigation.css` and `iconAssets.ts` against the recorded behavior. This is an ordinary local refinement: existing warm paired themes, system typography, restrained amber primary action, Phosphor assets and dialog/sheet framing remain authoritative. No visual-world workshop or new palette is involved.

The parent task explicitly authorizes a narrow merge into the existing design document and limits this pass to that document and this check. Frontmatter tokens, canonical section order, sidecar, product file and surface briefs are preserved.

## Changes recorded

- `apps/web/DESIGN.md`: corrected the account identity from 44px/16px initials to 56px/20px initials, with a 280px desktop popover, 16px identity padding/gap and vertically centred 15px semibold username. Recorded avatar camera states, anchored Add or Change/Remove menu, child-first Escape, Tab/Shift+Tab exits and return-to-avatar focus.
- Replaced superseded photo-pan and automatic-preview-enlargement guidance with a fully visible stationary oriented image, 44px clearance, centred 80% initial/reset crop, 25–100% source crop range, same-direction movement, pinch-spread selection enlargement and opposite-corner resizing. Recorded outward disjoint 44px handles, conditional 44px Move crop grip/leader, proportional guide marks, 224px minimum stage where width permits, source-bound checkerboard, inset focus, immediate Close focus and crop-preserving retry/footer behavior.
- Extended the existing Photo Guide/Photo Shade prose to their implemented camera-overlay use. No color, typography or component token was added or changed.
- `docs/qa/avatars/stationary-documentation-check.md`: this evidence and scope record. The parent owns the QA README refresh.

## Evidence checked

Validated all 184 entries in `stationary-final/capture-inventory.json` against their PNG signature and header dimensions, with no missing or extra PNGs in the two engine folders. The matrix contains 160 state captures across Chromium/WebKit, both themes and five viewport sizes, plus 24 source-shape captures. Verified all six recorded SHA256 source fingerprints against the current implementation. Confirmed 22 contact JPGs and seven canonical PNGs in `apps/web/.impeccable/review/profile-photos-stationary/`. Repeated these read-only checks after the late painted-corner hit-target correction and refreshed captures; all dimensions, paths and six source fingerprints still match. These file checks support evidence currency; they do not replace visual review.

The first critique and batched resolutions remain in `stationary-review.md`. Read the existing single detector output, `stationary-detector.json` (`[]`); no detector rerun was made. The initial fresh independent `stationary-finish-review.md` reported no material visual defect and required persistence corrections. Final review has since reopened for verification of the late functional correction; approval remains pending. This document corrects DESIGN.md; the parent task separately handles the QA README and final reviewer disposition.

At the late documentation update, the parent reported typecheck and 442 unit checks passing, with 26 focused browser cases passing (24 cases plus two presence-isolation reruns). The earlier two DPI recapture cases also passed. Those checks were not rerun for this documentation-only change. The full browser suite and production build remain pending; this record does not claim either is green. Verification follows the user's browser-only direction and makes no native or physical-device interaction claim.

The late source correction in `AvatarEditor.tsx`, `avatarCrop.ts` and `avatar.css` keeps each visible corner arm inside its own disjoint 44px target using an inset capped at 10px and scaled to one third of the selection side. DESIGN.md now records the painted-mark-within-target rule and the exact visible Move crop label, rendered on two lines. No recapture or detector run was performed by this documentation pass.

Validated the unchanged YAML frontmatter and canonical eight-section order. Compared the completed document against the pre-pass snapshot: edits are limited to the Photo Guide/Photo Shade bullet and Profile photos subsection. The sidecar, `PRODUCT.md` and all existing surface briefs are byte-identical to the pre-pass snapshot.

## Preserved boundaries and drift

No source, tests, product file, sidecar, QA README or surface contract was edited by this pass. Pre-existing sidecar narrative staleness, unrelated design drift and the two previously recorded orphaned briefs remain unmodified; their repair is outside this local refinement. The existing compact standard initials, system-font world and unrelated empty-canvas/zoom findings are not newly promoted into house rules. Historical `documentation-check.md` and older capture folders retain their original superseded context; the stationary records describe the current interaction.

## Parent completion update

The independent reviewer subsequently returned **ship**, superseding the pending disposition above. Final fresh-data checks on the corrected production bundle passed all 24 profile/photo/appearance cases, including desktop bearer/image-token access. The full run finished with 1,226 passed, 13 flaky, 17 skipped and 18 failed; fresh-data reruns passed 17 and skipped one. See `stationary-regression-results.md` for exact limits, baseline comparisons and commands. Production build completion is recorded in README.md. These verification updates do not change the documented interface or six source fingerprints.
