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
| A full tan lattice in the light theme, scored hard; header on a panel fill | Still a full grid, but soft: both directions use 70% of the border colour, the same in read and edit (the user wanted the grid kept). The header has no fill and one full-strength rule under it, and the title and header read as one zone |
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

## Round 2a (PR 4: column types, formatting, sort, the full bar and dock)

Screenshots in `round-2a/`: dark and light, desktop 1440 (a table with every type and some fills; the cells bar; the fill panel; the align menu; the tag picker, filtered and in full; the type menu; the cols bar with its sort menu; the column menu; the options editor with a recolour open; the rows bar) and phone 390 (read view; the cells dock; the fill sheet; the rows dock; the type sheet; the tag sheet).

Method: impeccable critique + audit as a single context (no sub-agents, as in the earlier rounds; the detector over the table files and the bar, dock and format components was clean), a hand pass through every flow with Playwright, and the screenshots above as evidence. Metrics held: 8px gaps, 12px panel padding, 32px fields, 24px dots (32px on a phone with 44px targets), icons rather than text in the bar and dock.

### What the review found, and the fixes

| Finding | Fix |
|---|---|
| The fill panel inherited Labels' 280px width, so seven dots sat left with a 60px blank on the right | It is as wide as its dots (240px with padding) |
| "Edit options" wore the same tag icon as "Column type" two rows above it | A list icon of its own |
| The tag picker marked the current tag with a checkbox square, which reads as multi-select; a tag is one choice | A bare tick, no box |
| The header's ⋯ sat on top of a right-aligned header ("Age"), and over centred ones on narrow columns | A right-aligned header keeps its ⋯ at the left of the column; centred ones on very narrow columns still overlap (see below) |
| Text a type couldn't read, in a filled cell, was dimmed with opacity, which could drop below 4.5:1 on the pastel fills | Italic instead; unfilled cells keep the (tested) muted colour |
| A draft typed into a right-aligned or bold cell started left-aligned and regular, then jumped back | The draft takes its cell's alignment and weight |
| The active cell in a range read slightly darker (round 1b follow-up) | The cause was the hover tint: the pointer rests on the active cell after Shift+arrows. No hover tint is painted while a range exists, and a test hovers the active cell and compares every cell in the range |
| On WebKit a tap on a dock button blurs the field, and a panel with nothing focused ended the edit | The canvas keeps the edit going while a table panel is open |

### Behaviour worth knowing

- A tag cell opens its picker on Enter, F2, a double click, a second tap, or the first letter typed (it lands in the filter). A new name is created with the next unused preset colour, together with the cell's value, as one undo step.
- A box ticks on Space or Enter, on a click on it while editing, and on one click when the table is only selected (like a to-do); never in the viewer. A range of boxes follows the opposite of the active one.
- Paws: 1 to 5 set, 0 or Delete clears, a click sets a paw and the same paw again clears. Letters and 6 to 9 do nothing, and the field takes no keyboard (`inputmode=none`, as for boxes and tags).
- Numbers and dates are typed in the browser's locale (`1.234,5` and `25.12.2018` in German) and always stored plain (a number, `YYYY-MM-DD`). A draft starts from the plain form, so typing it back changes nothing.
- Text a number or date column can't read is kept and drawn muted; changing the type back shows every value again.

### Left for later

- A centred header on a column narrower than about 80px still shares its space with the ⋯ on a phone; widening the column or turning the header left clears it.
- The native date wheel can't be driven in a test: the specs set the input's value, which is its whole contract with the table. Check the wheel on a real iPhone.
- On iOS, whether a tap on a dock button keeps the keyboard up depends on the browser; the emulated WebKit run keeps the edit going either way.

## Round 2 (PR 6: the final review) and a summary of every round

Screenshots in `round-2/`: dark and light, desktop 1440 (a new table; the read view; editing with a range and the cells bar; the fill panel; the cols bar with its sort menu; the rows bar; the tag picker; zoomed out to 30%; the read-only viewer; an agent proposal in the review and previewed on the board), phone 390 (read; the cells dock; the fill sheet; the rows dock; the cols dock; the type sheet; the tag sheet) and tablet 1024 (read; editing with the dock; the column menu).

Method: impeccable critique + audit as two isolated sub-agents (A: design review of the source and the screenshots; B: the detector and a code audit), then a hand pass through every flow with Playwright on desktop, phone and tablet as a first-time user. The detector was clean on every table file. The help article `make-a-table.json` is the other half of this PR.

### Findings and fixes

| Finding | Fix |
|---|---|
| A picked column's grip drew a column-wide grey tile that read as a stray box beside the open sort menu (the round 2a leftover) | The tint is a 36px pill behind the dots (28px tall for a row); the column's own tint shows which one is picked |
| A centred header on a narrow column shared its space with the ⋯ (round 2a leftover) | The header ⋯ is left out where the name would not leave room for it (the grip and the bar's ⋯ open the same menu) |
| On a phone, a table near the top or left edge put its grips under the top bar or off the screen (round 1b leftover) | The edit camera frames the card together with the 40px its grips hang over its top and left |
| The grips looked like "‹:::›" in the dark shots | They are clean `dots-six` glyphs; the flanking marks were the canvas's dot grid lining up with the grip row. The grips keep 70% opacity and now carry a tooltip |
| Ticked boxes were gold in every cell, against the One Lamp Rule | As a to-do's done box: the lamp's colour on a plain cell, the cell's own ink on a filled one |
| The gold active-cell ring vanished on a gold fill in the dark theme (about 1.3:1) | An ink ring runs just inside it on filled cells |
| The LOD drawing still had a header band and hard grid lines, from before round 1b | It draws the soft full grid with one full-strength rule under the header, as at full size |
| Ticks and paws had 31 to 35px targets on a touch screen | 44px: the geometric test and the tick's hit area give a finger 14px more on each side |
| Grips and the header ⋯ had labels but no tooltip, and no visible keyboard focus | Tooltips (the grips' text says "select, drag to move") and a 2px selection outline on `:focus-visible` |
| The phone menu's Done button carried an English aria-label that differed from its text | The label is dropped; the text is the name. The grip tint's transition also respects reduced motion |

### Everything, round by round

- **Round 1 (grid, editing):** touch taps on WebKit, the dock's ⋯, new tables left untouched are discarded, 44px add strips on touch.
- **Round 1b (structure, calmer look):** the soft full grid the user approved, quiet add pills, grips at 70%, a drop line that overshoots the card, keyboard row and column picking, the bar placed beyond the grips.
- **Round 2a (types, formatting, sort):** the fill panel as wide as its dots, a bare tick for a single-choice tag, an icon of its own for Edit options, drafts that match their cell, italics for text a type cannot read, no hover tint over a range.
- **Round 2 (this one):** the table above.

### Consciously deferred

- **Dark-theme fills** use the same full-strength swatches as notes, so a filled row is brighter than its card. Tinting them toward the panel would split the table's colours from every other card; revisit if it is still loud in real use.
- **Unticked paws** are drawn at 22% and an unticked box at 55% of the ink, below 3:1 for non-text contrast. They are placeholders that every table shares; a real-use look will say whether they need to be firmer.
- **Resizing a column by keyboard.** The strip is a pointer control; a "Column width" menu item or arrow-key resizing is the next step. On a phone the 16px strip is below the 24px target-size guide.
- **First-run teaching.** A new table has no hint that the dots drag or that a header has a menu; the guide covers it. A one-line hint under a new table is an option.
- **No sort state.** A sort is a one-off by design (rows never jump while someone types), so no column shows an arrow. The guide says so.
- **The checkbox's accessible name** changes with its state while `aria-checked` already carries it; a constant name would be a little quieter in VoiceOver.
- **Real-device checks** nobody can drive in a test: the native date wheel and whether a tap on a dock button keeps the keyboard up on iOS (rounds 2a), the system's selection menu for Copy, and the new edit camera on a real phone with the keyboard open.
