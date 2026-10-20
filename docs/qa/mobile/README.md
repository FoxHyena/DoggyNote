# Phones and touchscreens

DoggyNote was built for a Mac with a trackpad. On a phone, one finger drew selection boxes instead of panning. Android had no pinch. A tap on a note raised the keyboard at once. A 104px header and a 60px rail left about 315px of canvas, and menus ran off the screen. This record covers the rework of every flow for phones and tablets, and the rounds of visual and UX QA that followed.

[Open the before/after gallery](../../../output/review/doggynote-mobile.html) (run `python3 docs/qa/mobile/scripts/gallery.py` first) · [Every captured state](review-matrix.csv) · [Verification](verification.json)

## What changed

| Usage pattern | Before | After |
| --- | --- | --- |
| Quick capture | Inbox reachable only from the rail; no share target | Inbox in the thumb dock with Add and Photo; Android share sheet and the home-screen shortcut drop straight into it |
| Browse | One-finger drag drew a box; no pinch on Android | One finger pans, with momentum; two fingers pinch; boards open at a readable 80%+; back chevron goes up a level in one tap (long-press lists all) |
| Tick to-dos | 14px boxes, a tap opened the editor | One tap in the box's gutter ticks; taps on text or titles select |
| Light edit | Tap opened the keyboard immediately | Tap selects, tap again edits where you tapped; the card glides above the keyboard; formatting and Done ride on the keyboard |
| Add and arrange | Rail tools, hover handles | ＋ sheet for every card type, photos and the camera; selection bar docked at the bottom with Edit, Connect, Select, Bury; Undo toasts for moves and burials |
| Panels and menus | Desktop popovers that overflowed | Bottom sheets with a grip (drag down to close); a tap on the board puts a sheet away |
| Share links | Desktop viewer squeezed | Viewer pans, pinches and opens inner boards with a tap |
| Home screen | Not installable | Manifest, icons, standalone, safe areas, theme-coloured status bar, Add to Home Screen row in Account |
| iPad | Hover-only handles | Desktop layout kept; handles on the selected card only, floating selection pill, edit pill |

The mouse and trackpad path is unchanged: each pointer event chooses its behaviour from `pointerType`.

## Rounds

| Round | Reviewer | Evidence | Outcome |
| --- | --- | --- | --- |
| Before | — | [before/](before/): 181 states, 5 devices, both engines and themes | Baseline on `main` |
| Visual 1 | Self, while building | — | Connect banner wrap, handles while editing, pill over the edit dock, desktop leftovers (⌘, esc), back chevron, title room, iPad docking, landscape badge |
| Visual 2 | Independent subagent on the full capture set | [r2/](r2/) | 18 findings (V2-01 to V2-18), below |
| UX 1 | Independent subagent, 10 task walkthroughs on iPhone 15 Pro, Pixel 7, iPad | Scripts and shots outside the repo | 17 findings (UX1-01 to UX1-17), below |
| Visual 3 | Independent subagent, r3 compared with r2 | [r3/](r3/) | Verified V2; 14 new (V3-01 to V3-14) |
| UX 2 | Independent subagent, verified UX1 (a–p) and re-ran every task plus break attempts | Scripts and shots outside the repo | 14 of 16 UX1 items fixed, 2 partly; 10 new (UX2-01 to UX2-10) |
| Final | Capture of the finished build | [after/](after/) | Gallery compares before with r2, r3 and after |

## Findings

Severity is the reviewer's. "Fixed" means the next round or an e2e spec confirmed it.

### Visual round 2

| Id | Severity | Finding | Fix | Status |
| --- | --- | --- | --- | --- |
| V2-01 | High | Landscape login: Sign in off-screen | Top-aligned, smaller logo, scrollable card under 500px high; tightened again after V3-04 | Fixed |
| V2-02 | High | Landscape comments: thread collapsed to 0px | Thread flexes; reply box one line in landscape (V3-02) | Fixed |
| V2-03 | High | Edit dock squeezed the to-do button; ＋ showed through | Scrolling format row, real task icon, dock hidden while editing; Done icon-only under 400px (V3-05) | Fixed |
| V2-04 | High | SE title truncated | Back chevron and tighter header; kept the save mark (V3-08) | Partly, by choice |
| V2-05 | Med | Connect banner covered the picked card | Banner at the bottom, taps pass through it | Fixed |
| V2-06 | Med | Scrims inconsistent | Raised surface and top shadow for the non-modal panels | Fixed |
| V2-07 | Med | Landscape selection bar 115px tall | One row, about 62px | Fixed |
| V2-08 | Med | Phones opened boards at 55% | `readableCamera`: at least 80% | Fixed |
| V2-09 | Med | Comment badges above sheets | Badges below the bars | Partly (V3-10) |
| V2-10 | Med | Desktop leftovers: resize grips, tiny text links | `resize:none`; 44px buttons | Fixed |
| V2-11 | Med | Disabled buttons about 1.5:1 | Outline style, 5.5:1 light, 4.9:1 dark | Fixed |
| V2-12 | Med | Sheet anatomy inconsistent | Titles for Zoom and More | Fixed |
| V2-13 | Low | Fetch placeholder clipped, blank empty state | Shorter placeholder, `COPY.fetchHint`, paw glyph | Fixed |
| V2-14 | Low | Selection bar spacing and labels | Centred swatches, "Select", aligned Done | Fixed |
| V2-15 | Low | Add sheet orphaned File tile | 3×3 grid | Fixed |
| V2-16 | Low | iPad bars covered the rail | Offset by the rail; pill style on tablets | Fixed |
| V2-17 | Low | Dark checkbox on a yellow note 1.3:1 | Custom-drawn boxes with ink fill | Fixed |
| V2-18 | Low | Landscape panels had different widths | One width; dock hidden behind panels | Fixed |

### UX round 1

| Id | Severity | Finding | Fix | Status (UX 2) |
| --- | --- | --- | --- | --- |
| UX1-01 | High | Tap-to-edit put the caret in the wrong place | Caret stored card-relative, queued before `beginEdit`, re-projected after the glide | Fixed |
| UX1-02 | High | Pixel: dragging a short selected card hit a handle | Handles further out; a touch inside the card moves it | Fixed |
| UX1-03 | Med-High | Bold on a heading line broke the heading | `inlineRange` keeps block prefixes outside the marks | Fixed |
| UX1-04 | Med | Connect banner swallowed taps | Docked at the bottom, `pointer-events:none` except Cancel | Fixed |
| UX1-05 | Med | Undo unreachable while selected | Undo toasts for bury and (UX2-05) moves | Fixed |
| UX1-06 | Med | Burying gave no feedback | "Buried N cards · Undo" | Fixed |
| UX1-07 | Med | Inbox Place dropped the card behind the sheet | Placed in the visible top of the board, with a toast | Fixed |
| UX1-08 | Med | Share target dropped the shared words | `sharedText` keeps words with the link | Fixed |
| UX1-09 | Med | Sheets didn't block the canvas | First touch on the board closes the sheet | Fixed |
| UX1-10 | Med | Back chevron took two taps | Tap goes up; long-press lists parents | Fixed |
| UX1-11 | Low-Med | Desktop empty-board copy | `COPY.emptyTouch` | Fixed |
| UX1-12 | Low | No way back to a recent board | Recent section in the Boards sheet | Fixed |
| UX1-13 | Low | Sent comment below the fold | List scrolls after sending | Fixed |
| UX1-14 | Low | Landscape selection bar too tall | One row | Fixed |
| UX1-15 | Low | iPad bar over the rail; "Create link" with a link already there | Offset (V2-16); the button reads "New link" once one exists | Fixed |
| UX1-16 | Low | Sticky hover; Inbox field not focused | Hover gated to mouse (finished in UX2-04); field focused | Fixed |
| UX1-17 | Low | Rapid taps toggled the Add sheet | Taps on ＋ ignored for 350ms after it toggles | Fixed after UX 2 |

### Visual round 3

| Id | Severity | Finding | Fix | Status |
| --- | --- | --- | --- | --- |
| V3-01 | High | iPad selection pill wider than the canvas | Capped to the stage, smaller swatches | Fixed |
| V3-02 | High | Landscape comment thread 40px tall | Reply on one line with Send inline | Fixed |
| V3-03 | Med | Connect banner over the zoom pill | Pill hidden in connect mode | Fixed |
| V3-04 | Med | Landscape Sign in clipped | Logo and tagline tightened under 450px | Fixed |
| V3-05 | Med | Task button hidden under Done | Done icon-only under 400px | Fixed |
| V3-06 | Med | Landscape zoom pill and badge over cards | Smaller pill, badge hidden in landscape | Fixed |
| V3-07 | Low-Med | Share: invisible segment, bare text links, "Create link" | Account's segmented style; 44px buttons; "New link" | Fixed |
| V3-08 | Low | SE title truncated | Kept the save mark: it is the reassurance that work is saved | Won't fix |
| V3-09 | Low | Not every sheet has a close button | Grip and Escape close all of them | Won't fix |
| V3-10 | Low | Badge peeks over short sheets | Rare, cosmetic | Won't fix |
| V3-11 | Low | Landscape Buried bones a short panel | Full-height side panel like the Inbox | Fixed |
| V3-12 | Low | Overview clusters top-left | Matches desktop behaviour | Won't fix |
| V3-13 | Low | Plain empty states | Paw glyph on empty states | Fixed |
| V3-14 | Info | iPad add state not captured | Rail covers it; tested in `tablet-gestures` | n/a |

### UX round 2

| Id | Severity | Finding | Fix | Status |
| --- | --- | --- | --- | --- |
| UX2-01 | High | Taps on a to-do title or near a box at low zoom ticked items | Reach only covers the gutter beside a box, on that row; under 60% only the box itself | Fixed, `mobile-gestures` |
| UX2-02 | Med | Comment sheet survived a board change | Thread closes when the board changes | Fixed, `mobile-shell` |
| UX2-03 | Med | QA build stale | Rebuilt before the final capture | Fixed |
| UX2-04 | Low-Med | Remaining hover rules stuck on iOS | Every `:hover` gated to `html[data-input=mouse]` | Fixed |
| UX2-05 | Low | Undoing a move took two taps | "Moved · Undo" toast after a touch move | Fixed, `mobile-gestures` |
| UX2-06 | Low | Inbox Place can land on other cards | For now it lands on top, visible and selectable | Deferred ([TODO](../../../TODO.md)) |
| UX2-07 | Low | Shared title lost when the preview fails | Title kept on the link card | Fixed, `mobile-inbox` |
| UX2-08 | Low | Editor stayed mounted behind the Comments sheet | Opening a thread on touch ends the edit | Fixed |
| UX2-09 | Low | Viewer opens at the top-left at 80% | Readable zoom is deliberate; panning reaches the rest | Won't fix |
| UX2-10 | Low | Scrolled thread ran into the card name | Rule under the card name | Fixed |

### Task walkthroughs (UX 2, iPhone 15 Pro and Pixel 7)

| Task | Taps | Result |
| --- | --- | --- |
| Quick capture via the home-screen shortcut | 0 + typing | Pass |
| Browse: pan, open a child board, back | 4 | Pass |
| Tick to-dos | 1 each | Pass |
| Light edit and recolour | 5 | Pass |
| Add via ＋ and via double-tap | 3 + 3 | Pass |
| Move and connect | 4 | Pass |
| Inbox triage: place one, bury one | 3 | Pass, with Undo toasts |
| Reply to a comment | 2 | Pass |
| Signed-out share link | 1 | Pass |
| Boards recent and Fetch | 2 + 2 | Pass |
| iPad session; landscape on both phones | — | Pass |

Break attempts all held: bury three and undo, long-press box select, a 30-line note keeps the caret above the dock, pinch while editing keeps focus, rapid taps, and offline edits syncing on reconnect.

## Real devices and the simulator

- iOS Simulator (iPhone 16e, iPad mini) was used for the signed-out pages (login, viewer) and safe areas. Driving the signed-in app needs keystrokes through macOS accessibility, which prompts for permission, so those flows were checked in Playwright's WebKit with touch emulation instead.
- Real iOS showed read-only native checkboxes as black squares; DoggyNote now draws its own (`a216a6a`).

## Reproducing

```bash
pnpm --filter server e2e:serve                  # Worker with rex/fido (PORT and E2E_PERSIST_DIR to isolate)
cd apps/web && VITE_APP_VERSION=0.0.1 pnpm exec vite build --outDir /tmp/dn-dist
API_PORT=8787 pnpm exec vite preview --outDir /tmp/dn-dist --port 5198
node docs/qa/mobile/scripts/capture.mjs after http://localhost:5198 [device] [state]
for f in docs/qa/mobile/after/*.png; do sips -s format jpeg -s formatOptions 75 -Z 1200 "$f" --out "${f%.png}.jpg" && rm "$f"; done
python3 docs/qa/mobile/scripts/gallery.py       # output/review/doggynote-mobile.html
```

Captures are stored as JPEG at a 1200px longest edge to keep the repository small; the gallery reads `*.jpg`.
