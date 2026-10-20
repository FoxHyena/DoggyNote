# Everyday polish QA record (October 2026)

**Features in this round:**
- To-dos: done tasks sink, say when they were done, and can be folded or cleared.
- Notes: Tab nests list items, and live formatting on the line you're typing.
- Copy, cut, paste and duplicate.
- Agent proposals previewed on the real board.
- A legible Sync now.
- Columns: the first click selects.
- Movie and show cards from TMDB.

**How each round runs:**
1. **Capture.** `scripts/capture.mjs` seeds the "Movie night and chores" board (`scripts/fixture.mjs`).
   - It shoots every state on 8 devices in light and dark: Mac 1440 (WebKit), Chrome 1440, Mac 1024, iPad Pro 11, iPhone SE, iPhone 15, a phone in landscape, and Pixel 7.
2. **Visual review.** Fresh reviewers check the shots against a rubric:
   - overflow and safe areas;
   - contrast in both themes;
   - consistency with the existing UI;
   - legible states;
   - touch targets;
   - overview parity.
3. **UX review.** Reviewers drive real flows with real input on desktop (Chromium, WebKit) and touch (iPhone, Pixel, iPad), and try to break them.
4. **Triage.** Findings go into the table below, then get a fix, an e2e test where a test can catch it, and a recapture.

Run it:
```sh
pnpm --filter server e2e:serve                     # a Worker (or the QA stack in scripts/)
node docs/qa/everyday/scripts/capture.mjs <phase> http://localhost:5175 [devices] [states]
```

## Round 1: findings

**Sources:**
- Visual review: VD (desktop), VP (phones), VT (tablet).
- UX review: UXD (desktop), UXM (mobile).

Duplicates are merged under the first id.

| # | Sev | Area | Finding | Status |
|---|---|---|---|---|
| UXD-1 | High | Proposals | Approving failed with "Revision conflict" after any device re-measured a card's height. | **Fixed.** Height-only changes approve against the newer revision (`agents.ts`); e2e test added. |
| UXD-2 | High | Clipboard | Click into a note, then Shift-click another: the note kept the editor, and ⌘C/⌘V/⌘D did nothing. | **Fixed.** Shift-click ends the edit and selects both; e2e test added. |
| VD-2 | Med-High | To-dos | "Sort done to the bottom" was on, but lists that arrived unsorted stayed mixed. Same as VT-1, VP-1, UXD-5. | **Fixed.** Unsorted lists are tidied once when shown (not an undo step); e2e test added. |
| VD-1 | Med-High | Movies | In a column, the year line drifted down to the buttons. Same as UXM-11, UXD-13. | **Fixed;** e2e test added. |
| VP-2 | Med-High | Notes | The phone edit dock's indent/outdent sat off-screen behind Done. Same as UXM-1. | **Fixed.** List controls come first and Done is a tick on phones; e2e test added. |
| UXM-4 | Med | To-dos | A tap 0.8–1.1s after a tick could hit the row sliding into place. | **Fixed.** Taps are ignored while rows slide. |
| UXD-3 | Med | To-dos | Fold away had no effect while typing in the list. | **Fixed.** Fold and Clear finish typing first. |
| UXD-4 | Med | To-dos | ⌘Z didn't undo Clear done while typing in the list. | **Fixed;** e2e test added. |
| UXD-6 | Med | Notes | Backspace at a top-level bullet nested it, then merged it into the line above. | **Fixed.** It outdents nested items and unbullets top-level ones; e2e test added. |
| VD-6 | Med | Proposals | The banner covered changed cards; framing ignored it. Same as VP-4. | **Fixed.** Changes are framed in the free area. |
| UXD-8 | Med | Proposals | Next change didn't say where it was and shrank cards to 50% on phones. Same as UXM-2. | **Fixed.** Shows "2 of 4", marks the card, and keeps a readable zoom; e2e test added. |
| VT-11 | Med | Proposals | The Current view still showed Buried/Moved chips. Same as VD-13. | **Fixed;** e2e test added. |
| VT-10 | Med | Proposals | Text on Buried cards was about 2.5:1 contrast. Same as VD-12. | **Fixed.** Faded less. |
| VP-5 | Med | Proposals | The sheet's buttons sat under the home indicator. Same as UXM-6. | **Fixed.** Safe-area padding. |
| UXM-3 | Med | Proposals | With 2+ proposals, list rows were squashed. | **Fixed.** Rows keep their height and the list scrolls. |
| VT-13 | Med | Proposals | Refresh floated; raw "note"/"todo" names; the title appeared twice. Same as VP-11, UXM-12, VD-11. | **Fixed.** Plain names, a Refresh link, no repeated title. |
| VD-3 | Med | Movies | Watched posters vanished on dark cards. Same as UXD-10. | **Fixed.** Grey instead of transparent. |
| VD-4 | Med | Movies | Overview: an unpicked card drew as a poster with bars outside the card. Same as VP-6, VT-16. | **Fixed.** |
| VD-5 | Med | Movies | Overview didn't dim watched posters. Same as VP-7, VT-17. | **Fixed.** |
| UXD-7 | Med | Movies | An unknown IMDb link showed "Fetching…" forever. | **Fixed.** Shows "IMDb tt…"; e2e test added. |
| UXD-9 | Med | Movies | Refresh gave no feedback. | **Fixed.** Shows "Refreshing…". |
| VT-2 | Med | Movies | Two watched marks; layouts mixed between states. Same as VT-3, VP-3. | **Fixed** before review (stale shots). The badge now shows only on read-only boards. |
| VT-6 | Med | Movies | The phone search dock is an empty bar with Done. Same as VP-8. | **Deferred.** It's the dock for every non-note card (to-dos, links, titles); worth redesigning for all of them together. |
| VT-5 | Med | Movies | ✓/ⓘ are 28px. Same as UXM-7. | **Kept.** Invisible hit areas make them 32×44 without changing card layout (rule 12). |
| VD-9 | Low | Sync | "✓ Synced" looked like a primary button. Same as VP-12, VT-15. | **Fixed.** A quiet outline. |
| UXD-14 | Low | Sync | "Syncing…" flashed for 50ms; the label read "Save status: Save status". | **Fixed.** Holds 0.5s; clean label. |
| UXD-16 | Low | Proposals | Opening a preview shifted the top bar under the pointer, and focus stayed put. | **Fixed.** Stable top bar; the banner takes focus. |
| UXD-12 | Low | Movies | A pasted movie card hung off-screen. Same as UXM-8. | **Fixed.** It comes into view; Details does too. |
| UXD-17 | Low | Movies | The desktop tooltip said "tap". | **Fixed.** |
| UXD-11 | Low | To-dos | Undoing a tick within 0.8s still re-sorted. | Deferred. Rare, and one more ⌘Z fixes it. |
| UXM-5 | Low | To-dos | With sorting off and fold on, a tick vanished at once. | Deferred. Unusual settings combination. |
| UXM-9 | Low | Canvas | Editing a note pans the board about 35px. | Deferred. Existing edit framing, not new in this round. |
| UXM-10 | Low | Clipboard | Duplicate lands 20px down/right, over the original. | Deferred. Matches desktop; a phone-specific offset needs design. |
| VD-10 | Low | Notes | Nested bullets look slightly different editing vs. reading. Same as VT-9. | Deferred. |
| VD-14 | Low | To-dos | A selected to-do (editing) hides the done labels. | Deferred. The editor shows text only, by design. |
| VD-15 | Low | To-dos | The menu mixes a tick with action icons. Same as VT-8. | Deferred. |
| VT-7 | Low | Movies | Two orange rings in a selected search card. Same as VD-16. | Deferred. The card outline plus the input focus are both meaningful. |
| VT-12, VT-14, VP-9, VP-10, VP-13, UXM-13 | Low | Various | Smaller nits: preview row gap, dialog meta order, landscape banner height, buried vs. peach outline, tall cards on phones, preview pending movie. | Deferred. |

**Not app bugs:** a seed with stale heights (UXD-1 also reproduces in real use, so it was fixed); a scripting artefact (Pixel momentum); and several shots taken mid-rebuild (VD-8). Round 2 is shot from a single build.

## Round 2: findings

Round 2 checked every round-1 fix, then looked again. Shots came from one build (`2ee753c`).
All round-1 fixes passed except the dark watched posters (VD-3, now V2-1).

**Sources:** V2 (visual review), UXD2 (desktop UX), UXM2 (mobile UX), U (the maintainer).

| # | Sev | Area | Finding | Status |
|---|---|---|---|---|
| U-1 | Med | Notes | In a note, a ticked task's box sat ~4px below an open one's, reading and editing. | **Fixed.** The tick inside the box moved its baseline; boxes now centre on the line. e2e test added. |
| V2-1 | Med-High | Movies | Watched dark posters still vanished on dark cards. Same as UXD2-1. | **Fixed.** On dark cards the grey poster is lifted and not faded, with an outline. |
| V2-2 | Med | Proposals | Phone shots of the preview showed the sheet instead (the script tapped while it slid in). | **Fixed** in `capture.mjs`. |
| V2-3 | Med | Columns | The "3 cards" count was 4.0:1 light, 3.4:1 dark. | **Fixed.** Less faded. |
| V2-7 | Low | Notes | The phone Done tick was a 43×39 ellipse. | **Fixed.** A 44px circle. |
| V2-8 | Low | Proposals | Buried text was 4.4:1 in dark. | **Fixed.** Faded less. |
| V2-10 | Low | Movies | An open ⓘ looked like the filled ✓, so the card read as watched. | **Fixed.** Open Details is an outline. |
| V2-4 | Low | Overview | Watched posters were tinted in the overview but grey on the card. | **Fixed.** Grey in both. |
| UXD2-2 | Low | Proposals | The card Next change lands on was barely marked. | **Fixed.** A heavier outline with a tinted band. |
| UXD2-3 | Low | Movies | "Refreshing…" flashes for 20–50ms on a local stack. | Deferred. Real TMDB calls take longer. |
| UXD2-4 | Low | Notes | Backspace twice on a top-level bullet merges it into the line above; unbulleting one item restyles the next. | Deferred. Plain-line Backspace merges, as in any editor. |
| UXD2-5 | Low | To-dos | One ⌘Z after leaving a list undoes the whole editing session. | Deferred. Matches note editing: a session is one step. |
| UXD2-6 | Low | Proposals | A proposal made before a board was first opened conflicts once the board tidies its lists or resolves movies. | Deferred. The banner warns first; asking the agent again fixes it. |
| UXD2-7 | Low | Sync | The popover can say "Synced" for 1.6s after a background sync. | Deferred. |
| V2-5, V2-6, V2-9 | Low | Docks | H/S scroll off the phone dock; dock icon alignment; the format bar's top corners clip under the top bar. | Deferred. Existing dock design, worth one pass on all docks. |
