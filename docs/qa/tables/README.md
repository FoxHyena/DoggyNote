# Table cards: design review

## Round 1 (PR 2: grid, cell editing, compact bar, phone dock)

Screenshots in `round-1/`: dark and light, desktop 1440 (read view, active cell with a range and the cells bar, a draft being typed, the bar's menu) and phone 390 (read view, editing with the dock on the keyboard area; the keyboard is simulated by shrinking the visual viewport).

Method: impeccable critique + audit (single-context run, no sub-agents; the detector over the table files was clean), then a hand pass through every flow with Playwright.

### Findings and fixes

| Finding | Fix |
|---|---|
| The structure menu ran Delete row, Delete column and Clear cells together, so Clear read like a third delete | A separator now sets Clear apart |
| The range overlay was announced as content | `aria-hidden`; the live region and the field's label carry the cell |
| A touch tap on a cell never arrived on WebKit: the canvas cancels the touch's pointerdown, and WebKit then sends no click | Taps are recognised on pointerup; the + row/+ column strips and the dock act on pointerdown |
| The dock's ⋯ lost its click for the same reason | It keeps its own pointerdown (no cancel); its menu is allowed to hold focus without ending the edit |
| A touch double tap ran in-place editing on top of "select, then edit" | Ignored on touch |
| A sync pull that dropped something flushed the half-typed draft out of edit mode | A flush saves the draft but leaves it open |
| New untouched tables littered the board | A new table left exactly as it started is discarded when its edit ends |
| Dock buttons showed browser button chrome | Reset to the dock's flat 44px targets |
| + row / + column strips were 28px on touch | 44px on touch; they sit outside the card, so its height never changes |

### Left for later PRs

- Bold, align and fill have no place in the bar or dock yet (PR 4 puts them between › and ⋯).
- Row and column grips, drag reorder and clipboard are PR 3.
- On a phone the "+ column" strip is off to the right of the card (reach it by panning, or use ⋯).

## Round 1b (PR 3: rows, columns, clipboard, and the calmer look)

Screenshots in `round-1b/`: dark and light, desktop 1440 (read, edit, add pill hover, range over a wrapped row, row selected, row drag in progress, column menu, resize hover, column drag) and phone 390 (read, edit with the dock, row selected with the dock, column sheet).

Method: impeccable critique + audit as a single context (no sub-agents, as in round 1) plus the detector, then a hand pass through every flow with Playwright. The coordinator's own critique supplied the visual redesign spec, credited below.

### Before and after (round 1 against round 1b)

| Round 1 | Round 1b |
|---|---|
| A full tan lattice in the light theme; header on a panel fill | Row hairlines only (70% of the border); column lines are laid out but drawn only while editing (50%), so entering edit moves nothing; the header has no fill and one full-strength rule under it, and the title and header read as one zone |
| Cell text at 10px, title at 14px | The first and last columns pad 14px, so the text lines up with the title |
| Two gold things while editing (card ring and cell) | The card ring steps back to 55%, so the active cell is the one lamp |
| Two full-length dashed + strips | Quiet 56×20 and 20×56 pills, 55% at rest, full with a hover fill (mouse only); on touch a 44px target drawing a 28px dot |
| Placeholder title was grey text | A 20px paw and the COPY line; a table with no columns shows a paw and "An empty bowl" |
| Dock buttons bunched on the left | ‹ › on the left, a rule, the selection's own buttons in the middle (room for PR 4's three), ⋯ pushed to the right; 12px gutters |

### Round 1 follow-up 1: the range tint

Pixel sampling of `round-1/light-range-bar.png` and `dark-range-bar.png` shows the "Roast chicken" cell carries the same tint as its neighbours (the Cheese cell is lighter only because the pointer was hovering it). I could not reproduce a missed cell. The range is one rectangle from its first and last cells, measured in the same step that lays out the table, and a new e2e test asserts that rectangle covers exactly those cells with a wrapped row, after a column is narrowed, and after the range is stretched and shrunk. A range that reaches into the body now leaves the header out of the tint (muted header text sat at 4.503:1 on it in dark). It is 14% in dark and 18% in light.

### Findings and fixes (this PR)

| Finding | Fix |
|---|---|
| The drop line sat on the card's own ring when a row went to the end, and read as a dotted edge | The line overshoots the card by 8px on both ends |
| Grips at 55% opacity were hard to find | 70% at rest, full on hover, and a tint while their line is picked |
| The dock showed a rule with nothing after it in the cells context | The rule shows only when the selection has buttons of its own |
| Keyboard users could not pick a row or column (the grips are pointer controls) | Shift+Space picks the row, Ctrl+Space the column; Alt+Shift+arrows then move it |
| Two radii (1px) outside the design system | Removed (the detector is clean) |
| Typing with a row or column picked would have written into a cell nobody could see | Typing does nothing; Escape steps back to the cell first |
| The bar floated over the column grips | The bar positions beyond the grips (30px) while a table is being edited |

### Left for later

- On a phone, a table near the top of the screen puts the column grips under the top bar; the header's ⋯ (shown on the active column) reaches the same menu.
- Bold, Align, Fill, Type and Sort (PR 4) join the bar and dock before ⋯, in the dock's middle slots.
- The card's own resize handle is still a full-strength gold square: the second lamp while editing.
- Copy on a phone goes through the system's selection menu, which no test can drive; paste is tested with a synthetic paste event.
