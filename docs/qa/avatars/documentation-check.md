# Profile photos documentation check

Date: 2026-11-03
Disposition: complete; narrow extension of the existing Warm Den system.

## Source and authority checked

Read the documenter instructions and `reference/document.md`, the existing `apps/web/DESIGN.md`, `apps/web/PRODUCT.md`, the profile-photo surface contract and the incumbent sidecar. Checked the shipped `AvatarEditor.tsx`, `avatar.css`, `Avatar.tsx`, `AccountMenu.tsx`, `state/api.ts`, and `packages/theme/src/tokens.ts` against the recorded behavior. No browser recapture or computer control was used for this pass.

The implementation preserves the Warm Den surfaces, system type, amber primary action, modal/sheet framing and person-colour initials. Two photographic framing tokens are the only palette extension: `cropGuide` and `cropShade`, each present with the same value in both themes. They support white crop marks over dark outlines and shaded excluded image regions. They do not change the accent system.

## Changes recorded

- `apps/web/DESIGN.md`: added the two normative photo-guide colors and their narrow use, plus avatar sizing/fallback and editor behavior. Existing 10px initials remain the standard avatar treatment; the 44px account avatar uses the shipped 16px initials.
- `apps/web/.impeccable/design.json`: added only metadata and eight-step panel ramps for those two frontmatter tokens. Existing components, narrative, token metadata and generation timestamp remain unchanged; this is a partial merge, not a full regeneration. The ramps are panel swatch metadata, not new application colors.
- `apps/web/.impeccable/surfaces/profile-photos.md`: retained the direction contract, updated the story to match corner resizing, and recorded the shipped extension and final evidence locations.
- `docs/qa/avatars/documentation-check.md`: this evidence and scope record.

The editor guidance reflects four 44px draggable/keyboard corner targets, opposite-corner anchoring, photo pan, pinch, Reset, and no visible zoom slider. Enlarging a tiny preview does not change its source crop. Save produces a 512px square PNG for circular display. Errors preserve the editable crop and leave the action row accessible. Photos are signed-in only; share-token asset access returns no photo URL.

## Evidence checked

Validated every entry in `docs/qa/avatars/corner-crop/capture-inventory.json` against its PNG header: 100 PNGs, all dimensions match. The two browser directories cover both themes and account, crop, saving, error and saved states at 1440×900, 768×720, 393×659, 320×568 and 720×480. Confirmed ten contact JPG paths and five canonical sample PNG paths in `apps/web/.impeccable/review/profile-photos/`. This inventory check does not replace the independent visual review.

The primary agent reported the independent full browser finish review disposition as **ship**, with no material issues; its canonical report is `docs/qa/avatars/finish-review.md`. Typecheck, 438 unit checks and 14 focused browser checks were also reported passing by the primary agent and were not rerun for this documentation-only pass. The old WebKit sticker relative-performance failure was reproduced on baseline and is outside this feature. Native interaction testing was deliberately replaced by browser testing at the user's direction; no native interaction coverage is claimed.

Validated the canonical eight-section `DESIGN.md` order, new token references, no-slider guidance and eight-entry metadata ramps. Parsed the sidecar as JSON, removed the two new metadata entries in memory, and compared the remainder to HEAD: all pre-existing sidecar content is identical. The diff remains confined to the documented extension.

## Preserved boundaries

This pass does not replace the visual world, regenerate the whole sidecar, change product source/tests or `PRODUCT.md`, repair unrelated design drift, or repoint/delete the two pre-existing orphaned surface briefs. Pre-existing sidecar narrative staleness remains explicitly uncorrected because the approved scope is a local feature extension. No unrelated defect or craft-floor violation was promoted into a new design rule.
