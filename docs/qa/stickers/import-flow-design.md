# Pack import and Telegram connection design cleanup

Requested after the successful hosted bot walkthrough. The user will perform the updated manual test after this build reaches the isolated QA site. The earlier hosted reply/import pass remains recorded separately in [hosted QA](hosted/README.md).

## Design decisions

- Back navigation lives in the panel header, beside a short screen title. It no longer consumes another row between the header and the content.
- The Add screen presents one labeled link field and a full-width Preview action. Telegram is a separate, descriptive secondary choice with its own boundary and trailing navigation icon.
- Telegram separates the introduction, current connection stage, account management and pending suggestion. Each stage has one principal action. Once a candidate identity arrives, confirmation replaces the Open/link instructions.
- The raw connection URL is available through an optional disclosure. It remains selectable and accessible without competing with Open bot or Confirm.
- Connected status identifies the account. Disconnect and its retention explanation form a quiet management section. A pending suggestion puts the pack name in a heading, with a short Preview pack action rather than a long name squeezed into a button.
- Pack previews use a fixed reading order: title, readiness, source/Added state, artwork, then a full-width Add/Open action in a separate footer. Loading status stays with that action. Grid scrolling cannot push it away.
- Existing theme tokens, focus outlines, touch sizes, collection privacy, confirmation requirements and the mobile sticker shelf are retained.

## Review findings

| Finding | Change | Verification |
| --- | --- | --- |
| Arbitrary wrapped metadata and action widths in pack preview | Separate metadata, attribution and action footer; wrapping titles | Fresh preview captures and existing explicit-Add/loading checks |
| Raw pairing URL and Open action remained above account confirmation | Progressive disclosure; candidate identity replaces the launch instructions | Fixture pairing test expands the link and confirms through ordinary controls |
| Phone connection card pushed the suggested Preview below the initial viewport | Header back navigation; shorter pending-stage introduction; omit obsolete send instructions once a suggestion exists | Added a viewport assertion for the actual suggested Preview button |
| Pairing screenshot captured the transient disabled Connect button | Wait for enabled Connect and then visible Open bot before capturing | New captures must show the intended settled stage |
| Collection Add action looked like ungrouped text beside search | Small outlined button with consistent type and padding | Final collection/shelf captures |
| Phone-landscape pack details spread title, count and source across the column (round 28) | Pin the summary grid to the top (`align-content: start`) | New `mobile-sticker-import.spec.ts` asserts details/Add sit left of the artwork with a 44px Add; recaptured |
| Hosted tray flashed "Make room for a little fun" (no packs) while the collection was still loading | `collectionLoaded` signal; the tray shows "Loading your stickers…" until the first response | `stickers.spec.ts` holds `/api/stickers` and asserts the loading status and no empty-collection heading; observed on hosted |
| With packs saved, the empty Recent/Favorites state repeated a large Add pack under the header's Add pack | Empty-state Add pack and example link appear only when there are no packs | `stickers.spec.ts` asserts one Add pack with packs, two without |

## Final verification (2026-10-20)

- Full suite on the redesign (`CI=1 PERF=1 STICKER_VISUAL_ROUND=28 pnpm test:e2e --workers=4 --retries=0`): 438 passed, 4 intentional skips, 1 failure in `visual-canvas-entry.spec.ts` (Fetch). Cause: the result list remounted when sync delivered another test's same-named board, so a one-shot `boundingBox()` read a detached node. Fixed in the test by sampling title and snippet in one DOM read inside `expect.poll`, as the same test already does for its keyboard check. Rerun 6/6 across both engines with `--repeat-each=3`. No product change.
- After the landscape and collection-loading fixes: sticker specs (desktop, phone, tablet, visual and the new landscape spec) 27/27; perf-stickers was not rerun because the changes are tray-only; `pnpm typecheck` and `pnpm test` (162 unit tests) pass. The earlier full web/desktop/DMG build passed before these CSS/TSX-only changes; the QA web build was rebuilt.
- Inspected captures, kept in [round-28](round-28/): [Add pack](round-28/webkit-import-add-pack.png), [settled Open bot](round-28/webkit-bot-pairing.png), [phone account confirmation](round-28/chromium-import-phone-confirm-account.png), [phone connected suggestion, Preview above the fold](round-28/webkit-import-phone-connected-suggestion.png), [phone pack preview](round-28/webkit-import-360x740-pack-preview.png), [short desktop pack preview](round-28/chromium-import-1024x400-pack-preview.png), [phone landscape pack preview](round-28/mobile-chromium-landscape-pack-preview.png). Superseded round-27 and the rest of round 28 were pruned.
- Hosted QA redeployed with the isolated config only: Worker version `01cc968d-6d20-48d4-b7e7-994a2ae9a3c6` ([source manifest](hosted/deployment-source-redesign.json)). The sanitized status check after deploy: webhook still the QA URL, 0 pending, no error; pairing intact; collection still one `miniswizzyeen` pack, 96/96. In the signed-in hosted tab the tray showed "Loading your stickers…", then the pack with a single header Add pack.

## Manual handoff

After the refreshed QA deployment, ask the user to review Add pack, the connected/suggested Telegram states and pack preview on their normal screen/phone. If they choose to check the unpaired stages, Disconnect keeps their imported pack and placed stickers; reconnect requires their own Start and explicit confirmation. Do not initiate another real Telegram walkthrough or native-control session on their behalf. Keep this updated manual review pending until the user reports it. Handed to the user on 2026-10-20 against version `01cc968d`; their first pass is recorded below.

## User review round 1 (2026-10-20)

The user tested `01cc968d` on the QA site: preview/Add buttons, placement, dragging and resizing worked. They asked for five changes, now built:

| Request | Change | Verification |
| --- | --- | --- |
| Disconnect took a whole row under the account | Disconnect sits at the right of "Connected: @…"; hovering explains packs and placed stickers stay (title + `aria-description`), and a toast repeats it after disconnecting for touch users | `stickers.spec.ts` asserts the same row, the tooltip text and the toast |
| Suggestion showed the short name (`PeanutButter92871NaL`), not "Peanut Butter" | `GET /api/stickers/telegram` adds an additive `title` from the cached pack; the webhook caches that metadata once per new suggestion (no files, no messages; falls back to the short name if Telegram fails) | Integration test for title, fallback and webhook calls; e2e uses "Preview Doggy daydreams" |
| Stickers appeared roughly ten at a time | Load steps of 3 instead of 6 (optional `count`, default 6 for older clients), still two requests in flight, so Telegram load is unchanged | Integration test for `count`; `sticker-loading.spec.ts` asserts steps of 3 |
| Shadow looked like a soft gradient; then "slightly more subtle and closer" | Hard shadow from a top-left light: 1.5px offset (3px while lifting), new `--dn-sticker-shadow` token (light `#2a252129`, dark `#00000099`), applied outside the rotation so turning a sticker keeps the light top-left | `theme.test.ts` bounds the shadow's contrast on canvas and cards; [dark board](round-29/webkit-decorated-board.png) inspected |
| A sent sticker didn't show up unless you went Add pack → Telegram | Stickers button badge (desktop toolbar and phone launcher) and a "Pack found in Telegram" card at the top of the collection with Preview and dismiss. Status refreshes on tray open, window focus and every 20s while connected. Adding the pack clears the suggestion server-side | `stickers.spec.ts` (reload → badge → one-click preview → Add clears; dismiss clears); `mobile-sticker-import.spec.ts` (launcher badge, 44px Preview, one tap) |

Checks: full suite 443 passed, 4 intentional skips (before the subtler-shadow tweak, which only changed two CSS offsets/token values and was rechecked with the theme tests and the visual spec); 165 unit tests; typecheck. Captures kept in [round-29](round-29/): [found card](round-29/webkit-import-found-card.png), [phone found card](round-29/chromium-import-phone-found-card.png), [one-row Disconnect](round-29/webkit-import-phone-connected-suggestion.png), [selected sticker shadow](round-29/webkit-dark-selected-ring.png).

QA Worker now runs `67a3811b-ff7c-41f4-9ab4-1168ee203bf2` ([manifest](hosted/deployment-source-redesign.json)). After deploying, the hosted tab showed the badge for the user's pending `KebiBy22mg` sticker. Manual review of this build is pending.

## User review round 2 (2026-10-21)

Testing `67a3811b` with several real packs, the user found: a dragged sticker stayed behind others; Recent tiles resized while a pack loaded; suggestions first showed the short name (`Tokorozaw`) before the title (`Rin Tin Tin`); a second sent pack replaced the first; suggestions were only reachable through Send a sticker in Telegram; Preview greyed out after leaving a loading preview; and the suggestion card was too large. They chose: compact rows at the top of the tray and on Add pack; preview anytime while stickers fill in; packs prepare in the background while the app is open.

| Finding | Cause | Change | Verification |
| --- | --- | --- | --- |
| Dragged sticker not brought forward | Drag never changed `z` | First drag movement lifts the sticker above every other sticker; the move's undo step restores both | `stickers.spec.ts` drag-to-front test (order and one undo) |
| Recent tiles resized while a pack loaded | The collection's "Preparing stickers" line came and went per batch, toggling the grid's scrollbar | Progress lives on each pack row and in its preview; `.sticker-scroll` reserves its scrollbar (`scrollbar-gutter: stable`) | `sticker-suggestions.spec.ts` asserts no status line in the collection and a constant tile width during preparation |
| Short name shown before the title | The title was cached after the bot reply | The webhook caches the pack's metadata before saving the suggestion | Integration test: two packs listed by title immediately; Telegram failure falls back to the short name |
| Second pack replaced the first | One pending row per person | Migration `0011_telegram_suggestions`: every sent pack, newest first, until added or dismissed (packs already owned are never suggested). `pending` kept for older clients; `suggestions` is additive | Integration test for list, re-send ordering, per-pack dismiss, Add, owned packs, disconnect |
| Suggestions only under Send a sticker in Telegram | — | The same compact list at the top of the tray, on Add pack and on the Telegram screen; badge counts them | e2e on desktop, phone and the visual matrix |
| Preview greyed out after leaving a loading preview | One tray-wide `busy` flag held for the whole load | Shared pack loader (`state/packLoading.ts`): each pack keeps its own manifest, progress, error and retry; preparing continues in the background, two packs at a time | `sticker-suggestions.spec.ts` previews mid-preparation, goes back and finds every Preview enabled; existing loading/rate-limit specs pass on the new loader |
| Card too large | — | One row per pack: first sticker as icon with a progress ring, title, "From Telegram · n of m", small Preview and × | [desktop, preparing](round-30/webkit-suggestions-preparing.png), [phone](round-30/chromium-import-phone-found-card.png), [Telegram screen](round-30/webkit-import-phone-connected-suggestion.png) |

Checks: 166 unit tests; typecheck; full e2e 446 passed, 4 intentional skips, 1 failure (WebKit bot pairing) caused by a local wrangler dev-server "Network connection lost" between its proxy and the Worker during `POST /api/stickers/telegram/challenge`. The same specs then passed 87/87 over three parallel repeats with no proxy errors. The suggestion-row fit test and the visual spec (fixed: it now waits for a delayed response before removing its route) passed twice each.

QA: migration `0011` applied to `doggynote-stickers-qa` only; Worker `c1af5bd0-a57f-4f61-a12b-b2524ee8bdc7` ([manifest](hosted/deployment-source-redesign.json)). The sanitized status check shows the webhook healthy (0 pending), pairing intact, three packs in the collection, and the user's unadded Cartoon Coyote carried into the new list under its title. Earlier sent packs that the old single-row design had already replaced (Tokorozaw/Rin Tin Tin) were not recoverable; re-sending them adds them. The Paseo browser tab had disconnected, so no hosted screenshot was taken for this build. Manual review pending.

## User review round 3 (2026-10-21)

The user confirmed the round-2 flows and drag-to-front work, and asked for four refinements:

| Request | Change | Verification |
| --- | --- | --- |
| Add a pack straight from the list | A plus icon on each row adds the pack (enabled once a sticker is ready); anything still preparing continues, the pack is selected in the collection and a toast confirms it | `sticker-suggestions.spec.ts`: plus disabled at 0 ready, then adds, selects the pack and clears the row |
| Use an icon for Preview | Eye icon (accessible name "Preview <title>"); eye, plus and × are 30px icons (44px on touch) | Phone spec asserts 44px targets; [desktop](round-31/webkit-import-found-card.png), [phone](round-31/chromium-import-phone-found-card.png) |
| Keep the tray open while placing | A pin in the tray header (desktop and tablet; phones use the bottom sheet). Pinned, click-to-place and drag-to-board leave the tray open; Escape cancels a placement first. Remembered per device (`doggynote.stickerTrayPinned`) | `stickers.spec.ts` pinned-tray test (click, Escape, drag, reload, unpin); phone spec asserts no pin |
| A white border around every sticker | New `--dn-sticker-outline` token (white in both themes); four offset drop-shadows give a 2px die-cut border before the hard shadow (1px on tray tiles) | `theme.test.ts`; drag test asserts the five-part filter; [board](round-31/webkit-decorated-board.png) |

Checks: 168 unit tests; typecheck; full e2e 448 passed, 4 intentional skips, 1 failure in the visual matrix: its overflow check sampled the 360px tray immediately after a viewport change, while the header still showed the desktop-only pin (the device signal follows the media-query event). Fixed by letting header titles shrink with an ellipsis and polling the check until layout settles; the visual spec then passed 6/6, and the phone specs 24/24 over three repeats (one earlier WebKit tap on Add pack that didn't register did not recur).

QA Worker `cc5ff8c3-b871-498f-86c3-b7bc524f0619` ([manifest](hosted/deployment-source-redesign.json)); no new migration. Status after deploy: webhook healthy, pairing intact, three packs in the collection. Manual review pending.


## User review round 4 (2026-10-21)

The user found the round-3 flows good overall and asked for:

| Request | Change | Verification |
| --- | --- | --- |
| Preview from a row flashed a loading line at the top of the tray | The tray-wide "Loading…" status is gone. Packs this session already knows open instantly; otherwise the pack view opens at once with an in-place "Opening pack…" spinner. A typed link shows "Opening pack…" on its button and always fetches fresh, so its errors still show | `sticker-suggestions.spec.ts`, `visual-stickers.spec.ts` ("Opening pack…" button) |
| The pin showed no change until the mouse left | The pressed style now wins over hover: accent icon, filled pin, tinted background, selection border | `stickers.spec.ts` pinned-tray test hovers and clicks, then checks the accent colour while still hovered |
| The white border looked blurry | Replaced the four soft drop-shadows with an SVG die-cut outline (`feMorphology` dilate, alpha threshold, flood with `--dn-sticker-outline`): a solid 2px border on the board, 1px on tray tiles | Drag test asserts the `#dn-sticker-outline` filter and `feMorphology` radius 2; perf spec p95 unchanged |
| Size/Angle fields and text buttons in the sticker menu | The selected-sticker bar is six icon buttons floating above the ring, with tooltips: Bring forward, Send backward, Select underneath, View pack, Duplicate, Move to Buried bones. On phones it is a bottom sheet with short labels (Forward, Back, Under, Pack, Duplicate, Bury) and 44px targets | `stickers.spec.ts` (bar above the ring, icon size, titles, no sliders or number fields); `mobile-sticker-import.spec.ts` (sheet labels fit, launcher stays above the sheet) |
| "Remove size and turn entirely; maybe a reset by the circle" | The ring does all turning and resizing. A reset-rotation button sits at the ring's top-left while the sticker is turned. With the ring focused, arrow keys turn (←/→) and resize (↑/↓), with Shift for bigger steps; a burst of keys is one undo step | `stickers.spec.ts` keyboard test (+16°, +9 width, one undo, redo, reset hides the button) |

An intermediate build with pop-up sliders (round 32) was replaced before deployment at the user's request and its captures were removed.

Checks: 168 unit tests; typecheck; full e2e 451 passed, 4 intentional skips, no failures. The first full run had two test-only failures, both fixed. (1) The WebKit touch helper dispatched to the first-touched element. When a re-render under load detached it, moves never reached the canvas; real pointers are captured by the canvas. The helper now delivers to the canvas, as capture would, and `mobile-gestures` passed 128/128. (2) The sticker perf spec counted nodes 300ms after Ctrl+0, mid-animation; it now waits for 100% zoom and passed 6/6 (70 nodes, p95 16.7ms). Captures: [desktop bar and reset](round-33/webkit-light-selected-ring.png), [phone sheet](round-33/mobile-chromium-sticker-sheet.png).

QA Worker `bc4ad37f-f1c2-4fb0-b406-ba669ec7dd59` ([manifest](hosted/deployment-source-redesign.json)); no new migration. Status after deploy: pairing intact, collection unchanged, the user's unadded "Luke" pack listed as a suggestion by title. Manual review pending.

## User review round 5 (2026-10-21)

The user liked the loading flow and the pinned tray, and asked for:

| Request | Change | Verification |
| --- | --- | --- |
| Click away to close the tray (but not when pinned) | Unpinned, a press on empty board closes it. Placing, grabbing a sticker, card or ring, and board buttons (Undo, zoom) keep it open. Pinned, it stays until closed | `stickers.spec.ts` pinned-tray test (pinned click-away stays; unpinned zoom clicks stay, empty-board click closes); tablet spec taps away |
| Reset should restore size too | Reset returns rotation to 0 and width to a fresh sticker's size (longest side 144 at 100%, `defaultStickerWidth`), about the same center; it also shows for a sticker that was only resized. A sticker's placed width isn't stored, so this is the default size rather than the original | Keyboard test: resize and turn, reset, width back to the placed width, center unchanged, button hides |
| One ring around several selected stickers | Two or more selected stickers share one ring centered on the mean of their centers (stable while turning and scaling) and enclosing all of them. Dragging it turns and scales the group in one undo step; arrow keys work on it too. Scale is clamped for the whole group, so relative sizes hold. No reset on a group ring | Core unit test (`transformStickerGroup`, `stickerGroupRing`, `ringGesture`); desktop spec turns three stickers 30° and grows them 25%, ring center fixed, one undo; [capture](round-34/webkit-group-ring.png) |
| Grab one selected sticker to move them all | A selected sticker in a multi-selection starts the same drag as cards: all selected stickers and cards move together, stickers lifted above the rest in their own order, one undo. A click without moving selects just that sticker; Shift-click adds or removes stickers. A drag carrying stickers never drops into a column | Desktop spec (three stickers, then a sticker plus a card, grabbed either way); tablet spec (long-press box select, one-finger move, ring turn) |

Checks: 170 unit tests; typecheck; full e2e 454 passed, 4 intentional skips, before the pinned click-away change. After it, the sticker, tablet and phone specs: 37/38, the failure a local wrangler "Network connection lost" on `POST /api/stickers/packs/DoggyFixture` during setup; the WebKit sticker spec then passed 39/39. The existing ring test now aims at whole pixels, since WebKit delivers whole-pixel pointer positions.

QA Worker `81ad6525-3c74-42fe-b9ef-81feeb0679be` ([manifest](hosted/deployment-source-redesign.json)); no new migration. Pairing and collection unchanged. Manual review pending.

Follow-up: the user found the group ring larger than needed (centered on the mean of the sticker centers). It is now the smallest circle around every selected sticker's corners (`enclosingCircle`, incremental Welzl). Turning and scaling about its center maps the circle onto itself, so the ring still holds still during a gesture. Core tests cover collinear, obtuse and square point sets, and the ring staying put through a transform; sticker and tablet specs passed 28/28. QA Worker `c844279a-a0a3-4a54-9b62-a6c2b6dc4109`.
