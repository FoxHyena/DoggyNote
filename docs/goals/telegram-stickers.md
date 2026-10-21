# Telegram stickers on the DoggyNote canvas

Build a playful sticker collection and placement experience. People can bring in Telegram packs, choose a sticker, and stick it anywhere on a board: across a note's corner, over a photo, or on top of other stickers. Stickers are independent canvas overlays with resizing, rotation, and a subtle silhouette shadow. The experience should invite decorating a board while keeping ordinary board work easy.

This is an implementation brief for a future goal run. Creating this brief does not activate the goal.

## Start the goal

Paste this into the Codex conversation opened in this repository. `/goal` is a conversation command, not a shell command. Its outcome and continuation behavior are described in the [official OpenAI documentation](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex).

```text
/goal Implement the complete Telegram sticker experience specified in docs/goals/telegram-stickers.md. Continue through implementation, meaningful automated checks, hands-on interaction review, and at least two visual inspection and cleanup rounds until every required acceptance criterion passes. Follow the repository's engineering and performance rules. Record decisions, findings, fixes, command results, and visual evidence in docs/qa/stickers/. Keep the required experience separate from optional ideas. Do not mark the goal complete based only on passing tests or writing code: verify the finished desktop and touch flows, persisted transforms, permissions, export, and final visual states. If credentials or an external service block live verification, finish all independent work, document exactly what remains unverified and what input unlocks it, and keep that requirement incomplete. Leave a reviewable local diff; publishing and production deployment are outside this goal.
```

## Product scope

The required release includes pack-link import, the bot-assisted pack flow, a personal sticker tray, favorites and recents, local search, free placement, resizing, rotation, overlapping stickers, undo/redo, sync, shared-board rendering, and export. Include the small placement effects described below. Stamp mode and the other ideas in the last section are optional and must not delay these flows.

Use the person's existing DoggyNote account. Telegram social login is unnecessary for link import. Pairing the DoggyNote bot is a separate optional connection for the user, even though supporting that import route is required for this feature. Do not turn this work into a new authentication system or automatic installed-pack sync.

Personal pack membership, favorites, and recents belong to the DoggyNote user and sync between their devices. Placed stickers belong to their board. Removing a pack from the tray must never remove stickers already placed on boards. A collaborator or share-link viewer can see a placed sticker without importing its pack; that does not expose the owner's personal collection.

## Telegram research and adaptation

Research checked on 2026-10-20 using Telegram's official guides and desktop/Android source. These are documented/source-level observations; they are not a claim that the native Telegram apps were driven on a device. During implementation, revisit the sources and inspect available app demos or apps when useful. Record which platform was actually observed and distinguish Telegram behavior from DoggyNote design choices.

| Telegram interaction | Evidence | DoggyNote adaptation |
| --- | --- | --- |
| Browse packs by thumbnails, preview before adding, reorder pack icons, find stickers by emoji | [Telegram Tips](https://t.me/s/TelegramTips/304) | A compact thumbnail strip, pack preview, and search over the user's imported collection. Reordering is optional. |
| Desktop has a delayed large preview; releasing after preview does not send the sticker | [Desktop sticker panel source](https://raw.githubusercontent.com/telegramdesktop/tdesktop/dev/Telegram/SourceFiles/chat_helpers/stickers_list_widget.cpp), `showPreview` and `mouseReleaseEvent` | Separate preview from placement. Long-press or an explicit preview action must never accidentally commit a sticker. |
| Android sticker previews expose sending, favorites, and viewing the source pack | [Android preview source](https://raw.githubusercontent.com/DrKLO/Telegram/master/TMessagesProj/src/main/java/org/telegram/ui/ContentPreviewViewer.java), preview menu actions | Offer Place, Favorite, and View pack through a discoverable preview/menu, with keyboard equivalents. |
| One sticker can lead to its entire pack; packs also have shareable links | [Telegram sticker editor announcement](https://telegram.org/blog/sticker-maker) | Import a pack from a link or one sticker sent to the connected bot. A placed sticker's View pack action can open the same import preview. |

Unlike sending a chat message, placing on a board requires a position. Adopt Telegram's quick browsing and previews, then add an explicit placement step. Avoid adopting messaging actions such as scheduled sending or silent sending.

### API boundaries

- [Telegram Login](https://core.telegram.org/bots/telegram-login) supplies identity and optional profile/phone/bot messaging permissions. It does not grant access to a user's installed packs.
- Listing installed packs requires a separate authorized Telegram user session through [the client API](https://core.telegram.org/api/stickers). Full client authorization is outside this feature.
- The [Bot API](https://core.telegram.org/bots/api#getstickerset) can fetch a named set. Received sticker metadata can contain `set_name`; `getFile` prepares sticker bytes for downloading. These are the building blocks for the two import routes.
- Telegram's [import-stickers SDK](https://core.telegram.org/import-stickers) imports creations into Telegram. This feature imports existing packs into DoggyNote and should use the Bot API instead.

## Required user flows

### Open the sticker tray

Add one discoverable Stickers action to the existing canvas UI without crowding the header. On desktop, open a compact tray/popover with a grid and pack strip. On phones, use a bottom sheet that respects safe areas and leaves a usable portion of the canvas for placement. Keep previews inside the viewport, including short desktop windows and landscape phones.

The tray contains Recent, Favorites, imported pack thumbnails, a search field, and Add pack. Keep search scoped to the person's collection: pack titles/names and associated emoji, plus available sticker keywords. Do not suggest that global Telegram sticker search is available through the Bot API.

Show a useful empty state with Add pack and a short example of a pack link. Clear loading, empty-search, and recoverable error states must fit the same tray. Preserve selected pack and scroll position when returning from a preview.

### Add by pack link

1. Choose Add pack, then Paste a Telegram link. Support a validated `https://t.me/addstickers/<name>` link and a pack short name. Normalize supported variants explicitly; reject unrelated URLs without fetching them.
2. Resolve a preview with the real title, count, a sticker grid, source attribution/link, and an Add pack action. A reasonable lightweight preview may load before the full grid. Viewing a preview must not silently add the pack.
3. Confirm Add pack once. Show progress without blocking the whole app, then switch the tray to the new pack and make its usable stickers available. Do not falsely report success if all assets failed.
4. If already added, show Added and Open pack. Repeating a request must not create duplicate collection entries. Partial failures have a retry action and clear availability; do not silently omit unsupported stickers.
5. Removing a pack affects the personal tray only. Provide a clear removal action and recovery path. Previously placed stickers keep their stored assets.

### Add by sending a sticker to the bot

1. Add pack offers Send a sticker in Telegram. If unpaired, generate a short-lived, single-use pairing challenge for the signed-in DoggyNote user. Open the configured bot through a start deep link; show a desktop QR/link alternative when helpful.
2. Explain the action: connect the bot, then send one sticker from the desired pack. Telegram account pairing must not create a second DoggyNote identity or require Telegram social login.
3. Validate the bot update and pairing challenge server-side. Require an explicit confirmation back in the authenticated DoggyNote app before binding an incoming Telegram identity, so forwarding a pairing link cannot silently connect the wrong account. Make expiration, wrong-account recovery, cancellation, disconnect, and reconnect clear.
4. When a paired user sends a sticker with a set name, create a pending pack preview for that DoggyNote user. In the app, show the same preview and Add pack action as link import. Never place anything on a board automatically.
5. A sticker without pack metadata gets a helpful explanation and the paste-link alternative. Handle duplicate updates, repeated sends, and Telegram timeouts without repeated imports or noisy notices.
6. Disconnect stops future bot-assisted imports; existing collection entries and placed stickers remain. Keep pairing credentials and bot configuration out of ordinary canvas flows.

Any bot replies implemented as feature behavior must be limited to pairing/import acknowledgments and recovery. Test with fixtures and an explicitly configured test bot/account; do not message unrelated users.

### Pick and place

- **Desktop drag:** Drag from the tray onto the canvas. Show a lightweight lifted ghost with the same silhouette and a slightly raised shadow. Commit once at release. Dropping outside the canvas or pressing Escape cancels with no new object and no undo entry.
- **Click or tap:** Choosing a sticker arms placement and clearly shows the selected sticker plus Cancel. The next canvas click/tap places it once and exits placement. Close or collapse the mobile sheet enough to reveal the target area; a finger-offset preview keeps the intended position visible. Provide a keyboard Place action that creates it at the visible canvas center and selects it for adjustment.
- **Preview:** Long-press in the tray enlarges the sticker; an explicit Preview control works for mouse and keyboard users. Scrolling the tray cancels a pending long-press. Releasing a preview does not place. Avoid competing long-press, drag, and scroll recognizers.
- **After placement:** Select the new sticker and expose small, readable controls for adjusting it. Return to normal canvas behavior. Add to Recent only when placement commits. Undo removes the placement in one step.
- **Repetition:** Reopen the tray at the last pack and preserve its scroll position. Duplication uses existing app conventions. Reserve any new keyboard shortcut only after checking for collisions.

Start with a consistent, useful size relative to the visible viewport and a neutral rotation. Preserve the asset's aspect ratio. Placement and manipulation must remain correct while zoomed, panned, and on a high-DPI screen. Do not apply random rotation unless the user explicitly enters an optional scatter mode.

## Sticker object behavior

- Stickers sit above ordinary cards and connectors, below app chrome and selection controls. Maintain explicit ordering among stickers and provide Forward/Backward actions. Selecting an underlying card must not raise it above stickers.
- A sticker can straddle card, image, and column edges. It is neither clipped by nor inserted into those objects. It never joins a column, participates in card layout, creates a connector target, or changes measured card heights. Grid snap remains available for cards and does not affect stickers.
- Default position is fixed in board coordinates. Moving an underlying card leaves the sticker where it was. This makes freely overlapping multiple objects unambiguous. Automatic attachment and following a card are deferred.
- Selection exposes proportionate resize handles and a rotation handle with readable cursors. Rotation follows the center; resize uses correct local coordinates even after rotation. Provide accessible size/angle controls and Reset rotation so touch and keyboard users can perform the same adjustments.
- Set sensible minimum/maximum sizes. Prevent NaN, infinity, negative dimensions, unbounded transforms, and invisible handles from malformed synced data. Use rotated bounds for culling, hit-testing, selection, framing, and export.
- A completed move, resize, or rotation is one undo action. Cancel and `pointercancel` restore the pre-gesture state. Copy/paste and duplication preserve appearance and transform; paste gets a small predictable offset. Delete/restore follows existing app conventions.
- Transparent padding should not act as a large invisible blocker. Use an alpha-aware hit region or a measured silhouette approximation with a small touch allowance; decide after inspecting real assets. Provide an accessible way to select the card underneath when a visible sticker covers it, such as an explicit Select underneath action. Do not leave a canvas-sized pointer-catching overlay mounted.
- The silhouette gets a subtle, theme-aware drop shadow, never a rectangular image-box shadow. Account for shadows already baked into Telegram assets; avoid heavy double shadows or adding thick outlines to every sticker.
- On pickup, lift slightly; on release, settle with a brief gentle scale/shadow transition. Use approximately 120–200 ms as a starting point, then tune from observation. Motion does not change persisted coordinates or angle. Reduced motion removes ornamental movement. No default sound, confetti, or endless wobble.

## Implementation constraints

Read applicable repository instructions, `CLAUDE.md`, and current implementations before choosing the model. This repository uses SolidJS, a DOM-free TypeScript core, a Hono Worker, D1, R2, per-field sync, and a Tauri macOS client. Extend these systems without introducing a separate drawing framework or service solely for stickers.

- Inspect `packages/core/src/model.ts`, patches/undo and geometry; `apps/web/src/canvas/Canvas.tsx`, hit-testing, paste/drop and LOD; state actions, persistence and sync; server sync validation, access, assets and share/export handling. Also inspect agent/MCP object schemas so a new object type cannot bypass validators or crash existing readers.
- A distinct overlay entity or an explicitly separate rendering path is acceptable. Whichever representation is chosen must enforce overlay semantics throughout the client and server. Do not merely style an image card and inherit column/drop behavior accidentally.
- Persist position, size, angle, ordering, board identity, and stable asset/pack provenance. Keep transforms compatible with field-level conflict handling and undo. Specify simultaneous-edit behavior and verify reconnect cannot resurrect stale fields.
- Preserve old desktop compatibility. Make API/storage changes additive, check old-reader behavior, and use the project's protocol/minimum-client gate if required. Never silently erase new stickers when an older client saves a board.
- Route imported bytes through controlled server fetching and R2-backed asset delivery. Never expose bot-token download URLs or tokens to clients, logs, screenshots, errors, or persisted documents. Validate pack identifiers and upstream responses; bound downloads, parsing and animation resource usage; handle rate limits and retry-after responses. Do not fetch arbitrary pasted URLs.
- Keep each person's collection private. Apply existing board grants, private Inbox rules, and scoped share access to placed sticker metadata and bytes. A globally deduplicated cache must not become an authorization shortcut. Define asset retention/reference behavior so removing a pack does not break placed stickers.
- Handle static WEBP/PNG, animated TGS, and video WEBM deliberately. Verify transparent rendering in Chromium, WebKit, and the Tauri webview. Prefer lazy, bounded playback; keep a transparent still representation for reduced motion, overview/LOD, export, and codecs unavailable on a client. Do not show a black rectangle or silently lose a sticker. Document any format limitation as an incomplete requirement unless a usable fallback is verified.
- Preserve performance rules: pan/zoom updates the world transform, not every sticker; position outer wrappers with left/top; isolate required rotation on inner visuals. Cull using rotated bounds, keep hit-testing available at LOD, pause off-screen animations, avoid permanent compositing layers for every sticker, and do not animate all tray thumbnails simultaneously. Measure any needed exception to existing transform rules.
- Use existing theme variables and `COPY` conventions. Support dark/light themes, pointer capture, touch hit targets, focus restoration, screen-reader names, visible focus, and reduced motion. Stickers must not hijack note editing, app shortcuts, one-finger panning, or two-finger canvas pinch. Touch rotation/resize handles are required; simultaneous two-finger sticker transforms are optional.
- Export includes stickers in the same visual order, size, angle, and bounds as the canvas, with no selection chrome. A read-only share has no editing/placement affordances and never requires the viewer to connect Telegram.

## Work and review loop

Maintain `docs/qa/stickers/README.md` with a checklist, decisions, current blockers, exact checks and results, and links to a small curated set of screenshots or recordings. Keep a findings table with severity, reproduction, fix, and verification. Screenshots should show meaningful states, not just an empty tray. Do not claim a test or manual review ran unless it did.

1. **Interaction plan and technical slice.** Revisit Telegram evidence, map the actual app architecture, and write a short state/gesture plan. Resolve preview-versus-place, tray scrolling, overlay ordering, format handling, permissions, and pairing before broad UI work. Build the smallest real path from link preview to a persisted placed sticker. Use deterministic fixtures so development and CI do not depend on live Telegram.
2. **Complete behavior.** Add bot pairing/import, collection operations, formats, transforms, sync, sharing, export, recovery, and accessibility. Add meaningful automated coverage as each flow is built. Inspect actual behavior in the running app.
3. **Engineering self-review.** Read the resulting diff as a maintainer. Trace server authorization, trust boundaries, object validation, per-field sync, undo/redo, asset lifecycle, backwards compatibility, performance, and malformed input. Record and fix findings, then rerun affected checks.
4. **UX self-review.** Perform the tasks below using ordinary controls, real pointer/touch input, and keyboard navigation. Assess discovery, number of steps, cancellation, error recovery, focus, gesture ambiguity, canvas obstruction, and whether the flow invites another sticker. Fix friction and rerun affected walkthroughs. Review the feature without relying on implementation knowledge.
5. **Visual round one and cleanup.** Capture and actually inspect the tray, pack preview, bot pairing, loading/error/empty states, placement ghost, selected/rotated sticker, and a decorated populated board. Check light/dark; desktop 1440 and 1024 px; 720 and 600 px windows; 360/390 px phones; tablet; short windows and phone landscape. Look for clipping, abrupt layout shifts, uneven grids, excessive shadows, fuzzy scaling, awkward overlap controls, animation jumps, blocked canvas targets, and safe-area/keyboard collisions. Fix concrete findings.
6. **Visual round two and regression review.** Recapture the changed states on the latest build, inspect them again, and repeat complete import → decorate → reload/share/export tasks. Run the final checks after the fixes. If findings remain, continue focused fix/review rounds. Two rounds are a minimum, not automatic evidence of completion.

Self-reviews are separate passes by the implementing agent. No delegated agents are necessary for this goal. Keep optional ideation from expanding the required release indefinitely.

### Walkthroughs that must work

| Task | Required evidence |
| --- | --- |
| New user imports a valid pack by link, previews, adds, and places one sticker | Real app walkthrough plus deterministic integration/E2E coverage; one live import when configured |
| User pairs the bot, confirms the correct identity, sends a sticker, and adds the suggested pack | Complete fixture-backed flow, negative/replay cases, and a live test with a configured test account before claiming live verification |
| User decorates a populated board by mouse, then moves, resizes and rotates overlapping stickers | Pointer-driven checks at multiple zoom levels; screenshot of at least five overlapping stickers across notes, images and a column |
| Phone user scrolls and previews the tray, taps to place, cancels, then moves/resizes/rotates | iPhone WebKit and Pixel Chromium touch checks using existing touch helpers; no accidental placements or hijacked canvas pinch |
| Keyboard user adds a pack and places/adjusts a sticker without dragging | Focus and keyboard walkthrough, including Escape and focus restoration |
| User undoes/redoes each transform, duplicates, deletes/restores, reloads and opens a second session | Assertions against persisted geometry and ordering, sync/reconnect checks, and visual confirmation |
| User favorites a sticker, searches by emoji/name, reopens the tray and removes a pack | Collection remains private and consistent across devices; placed stickers survive removal |
| Viewer opens a shared board; owner exports it | Correct overlays, transparent assets, angle/order and bounds; no editor controls; private/ungranted assets remain inaccessible |
| Telegram times out, returns an invalid pack, rate-limits or sends duplicate updates | Recoverable states, bounded retries, no false success, no duplicate entries, no secret exposure |
| A large board has hundreds of placed stickers, including animated assets | Existing perf checks and a representative sticker-heavy fixture; culling/LOD and paused off-screen playback verified |

## Completion criteria

Every required flow above must pass. Finish only when there are no unresolved critical/high engineering findings, no known task-blocking UX defects, and no visible clipping, handle collisions, accidental placements, rectangular transparency artifacts, or broken shadows in the reviewed matrix. Record small remaining improvements explicitly; optional ideas are not release blockers.

Required final checks, adjusted only if the repository's commands have changed:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
git diff --check
```

Add focused Playwright sticker coverage for desktop Chromium/WebKit, phone WebKit/Chromium, and tablet touch behavior. Use actual input helpers rather than injecting final transforms and calling that gesture coverage. Cover pure geometry and server boundary behavior with targeted unit/integration tests. Run existing performance coverage plus the sticker-heavy case; compare against the current baseline. Manually inspect a freshly built isolated Tauri app for drag, scaling, transparency and rotation, and native persistence after closing/reopening. If native tooling is unavailable, record that check as unverified.

Do not skip failing unrelated checks silently. Diagnose and report any pre-existing failure separately. Do not replace real Telegram integration checks with mocked results in the final report.

External configuration may require a bot token, bot username, webhook setup and a test Telegram account. Implement configuration hooks and fixture-backed verification while those are missing. Finish all independent work, then report the exact missing setup and remaining live/native checks. Do not deploy production services, fabricate credentials, or mark blocked verification as passed. Follow the goal runtime's blocker rules; do not spin on the same external dependency.

The final delivery must link the changed implementation and QA record, summarize the interaction decisions, identify checks actually run, show final visual evidence, and state any remaining limitations. Required unmet criteria mean the goal is not complete.

## Optional ideas for a later delight pass

Choose sparingly after the required flow feels good. Keep each experiment reversible and test whether it improves actual use.

| Idea | Interaction | Guardrail |
| --- | --- | --- |
| Stamp mode | A visible Stamp toggle keeps one sticker armed for repeated clicks/taps; Escape or Done exits | Explicit mode indicator and one undo step per stamp; never surprise users with repeated placement |
| Small scatter | In stamp mode, an opt-in variation adds a few degrees of tilt per placement | Choose the variation once per committed sticker and persist it; normal placement stays precise |
| Peel to move | Existing pickup effect grows the shadow and gently lifts a sticker; release presses it flat | Visual effect only; no coordinate jumps or long animation, reduced-motion alternative |
| Sticker sheet | A preview arranges a pack like a tangible sheet, with a soft lift on the focused sticker | Still a fast accessible grid; preview and dragging must remain unambiguous |
| Surprise me | Pick a random sticker from the current pack, then preview it before placement | Never draw from the whole internet or place automatically |
| Pocket favorites | Favorites feel like a small personal pocket of frequently used stickers | A simple saved collection, with no arbitrary scarcity, streaks, or reward notifications |
| Attach to card | An explicit Attach action makes one sticker follow a chosen card | Separate design work for moves, columns, deletion, multi-select and board transfer; never infer attachment from overlap |
| Optional tactile tap | Use the existing native haptic mechanism for a committed placement | Feature detection, user preference, and no default audio |

The core delight is direct manipulation: choose something expressive, place it exactly where it belongs, tilt it a little, and build up a collage. Prioritize that feeling over extra modes or decorative UI.
