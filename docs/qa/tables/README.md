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
