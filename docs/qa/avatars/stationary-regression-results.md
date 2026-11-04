# Stationary photo refinement regression results

Date: 2026-11-03. Browser automation only; no production deployment or native interaction walkthrough.

The full regression run collected 1,274 cases and finished in 24.5 minutes: 1,226 passed, 13 flaky (passed on retry), 17 skipped and 18 failed. It began before the late visible-corner hit-target correction; current corrected production-bundle photo coverage is recorded in README.md. This is not a claim that the final source passed a clean full-suite run.

All 18 failures were rerun against the current source with fresh isolated data and two workers: 17 passed, one native-scroll test skipped by its existing browser guard. No application change was needed for these reruns. Mobile failures mostly timed out waiting for canvas while the snapshot displayed Fetching; the collaboration failures concerned note merging and competing geometry. Both collaboration cases additionally passed against untouched baseline db5a70f37627fc6d7c22201b6d577c9b620e52c3. These observations establish sensitivity to the original run conditions, not a reproduced persistent baseline defect. The earlier feature's WebKit 500-sticker performance failure passed in this run.

Commands:

```sh
E2E_PORT_OFFSET=180 E2E_PERSIST_DIR=/private/tmp/doggynote-avatar-refinement-full pnpm --filter web exec playwright test --workers=4 --retries=1
E2E_PORT_OFFSET=190 E2E_PERSIST_DIR=/private/tmp/doggynote-avatar-refinement-retry pnpm --filter web exec playwright test --last-failed --workers=2
# Separate untouched baseline checkout:
E2E_PORT_OFFSET=220 E2E_PERSIST_DIR=/private/tmp/doggynote-avatar-stationary-baseline pnpm --filter web exec playwright test multiplayer.spec.ts --project=chromium --grep 'two authors type|competing drags' --workers=1
```

Original full-run summary:

```text
18 failed
    [chromium] › e2e/multiplayer.spec.ts:125:1 › two authors type in one note, merge within one second, and undo only their own typing
    [chromium] › e2e/multiplayer.spec.ts:329:1 › competing drags and a resize converge, while cancellation and deletion clear previews
    [mobile-webkit] › e2e/mobile-gestures.spec.ts:226:1 › zoomed out, a tap on a card inside a column picks that card
    [mobile-webkit] › e2e/icon-checks.ts:5:3 › board icon choices keep their saved IDs and unknown icons fall back safely
    [mobile-webkit] › e2e/mobile-image-captions.spec.ts:13:1 › double-tap an image to caption it; Edit in the selection bar opens it again
    [mobile-webkit] › e2e/mobile-image-captions.spec.ts:109:3 › double-tapping an image already selected focuses the caption in the tap, and a late mousedown can't take it
    [mobile-webkit] › e2e/mobile-image-captions.spec.ts:147:1 › a caption gets no edit dock, and the keyboard’s own ✓ finishes it
    [mobile-webkit] › e2e/mobile-image-captions.spec.ts:177:1 › when the keyboard opens, the caption glides above it in one move
    [mobile-webkit] › e2e/mobile-inbox.spec.ts:41:1 › a link shared from another app lands in the Inbox
    [mobile-webkit] › e2e/mobile-labels.spec.ts:8:1 › tap a card, open labels from the bar, create one with a colour and rename it in place
    [mobile-webkit] › e2e/mobile-link-previews.spec.ts:9:1 › phone: guarded, tall and dead preview images
    [mobile-webkit] › e2e/mobile-motion.spec.ts:28:5 › dark, normal motion › Add reopens immediately after outside dismissal and still focuses a new note
    [mobile-webkit] › e2e/mobile-motion.spec.ts:53:5 › dark, normal motion › a cancelled sheet pull rolls back and ignores another pointer
    [mobile-webkit] › e2e/mobile-motion.spec.ts:92:5 › dark, normal motion › the phone notification stays centered at the top and Undo restores its card
    [mobile-webkit] › e2e/mobile-motion.spec.ts:28:5 › dark, reduced motion › Add reopens immediately after outside dismissal and still focuses a new note
    [mobile-webkit] › e2e/mobile-sheet-motion.spec.ts:204:1 › leaving phone layout clears an owned drag and capture
    [mobile-webkit] › e2e/mobile-sheet-motion.spec.ts:219:1 › long sheet content keeps native vertical scrolling
    [mobile-webkit] › e2e/mobile-sheet-motion.spec.ts:235:1 › a scrolled Share sheet keeps its grip above the sticky close control
  13 flaky
    [chromium] › e2e/sticker-suggestions.spec.ts:28:1 › several sent packs list together by title, prepare in the background and preview while preparing
    [mobile-webkit] › e2e/mobile-distill.spec.ts:156:3 › more sheet retains grip cancellation, dismissal and selection focus after integration
    [mobile-webkit] › e2e/mobile-editing.spec.ts:50:1 › the keyboard’s own ✓ (a blur) finishes a note
    [mobile-webkit] › e2e/mobile-gestures.spec.ts:113:1 › a second finger turns a card drag into a pinch and puts the card back
    [mobile-webkit] › e2e/mobile-image-captions.spec.ts:213:1 › the keyboard closing finishes the caption, even when focus stays
    [mobile-webkit] › e2e/mobile-image-colours.spec.ts:32:1 › tap a colour in the sheet and the picture is framed in it
    [mobile-webkit] › e2e/mobile-motion.spec.ts:53:5 › dark, reduced motion › a cancelled sheet pull rolls back and ignores another pointer
    [mobile-webkit] › e2e/mobile-motion.spec.ts:69:5 › dark, reduced motion › camera zoom and edit framing respect motion preferences and preserve editor focus
    [mobile-webkit] › e2e/mobile-motion.spec.ts:92:5 › dark, reduced motion › the phone notification stays centered at the top and Undo restores its card
    [mobile-webkit] › e2e/mobile-sheet-keyboard.spec.ts:49:1 › the share sheet sits on the keyboard: the username field and Invite stay in view
    [mobile-webkit] › e2e/mobile-sheet-motion.spec.ts:252:1 › a mouse-opened card menu on a phone dismisses from its explicit grip
    [mobile-webkit] › e2e/mobile-sketches.spec.ts:84:1 › Draw from the + sheet puts ink on the board; its bar fits the phone
    [mobile-chromium] › e2e/mobile-areas.spec.ts:5:1 › area headers stay attached through horizontal panning and zoom
  17 skipped
  1226 passed (24.5m)
```

Final current-source photo verification passed 24/24 cases on fresh data, including both desktop engines, both emulated phone engines and desktop bearer/image-token access. Four additional review cases passed and produced 184 final PNGs. Workspace typecheck, all 442 unit/integration cases and production build including Mac app/DMG packaging passed.
