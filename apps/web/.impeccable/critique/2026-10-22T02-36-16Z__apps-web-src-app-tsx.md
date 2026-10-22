---
target: apps/web
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-10-22T02-36-16Z
slug: apps-web-src-app-tsx
---
# Critique: DoggyNote web app (apps/web)

Method: dual-agent (A: design review · B: detector + browser overlay)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Desktop bury has no feedback; tiny save tick; raw "Bad Gateway" on sync failure |
| 2 | Match System / Real World | 3 | Dog vocabulary clear; "Shared space — Existing workspace boards…" is migration jargon |
| 3 | User Control and Freedom | 3 | Undo/redo visible and Restore panel, but no desktop Undo toast |
| 4 | Consistency and Standards | 2 | Card right-click only "Look here"; columns lack Labels; comment composer jumps |
| 5 | Error Prevention | 3 | Bury is soft delete; Empty has danger style |
| 6 | Recognition Rather Than Recall | 2 | 12+ icon-only targets in selection bar; no names on touch |
| 7 | Flexibility and Efficiency | 2 | ⌘K, ⌘0/⌘1, nudge exist; no tool keys, shortcut sheet or card context menu |
| 8 | Aesthetic and Minimalist Design | 3 | Calm and flat; selection bar covers neighbouring cards |
| 9 | Error Recovery | 1 | "Bad Gateway" + Retry, no reassurance; login error is a coral slab |
| 10 | Help and Documentation | 1 | No help or shortcut entry anywhere |
| **Total** | | **22/40** | **Acceptable** |

## Design Specificity Verdict
LLM: authored in colour and material (Warm Den browns, dotted floor, light paper twin, tilted paw logo, paw board tiles). Character stops at nouns; emotional moments (empty board, wrong password, sync failure, bury) are generic. One Lamp Rule bent: gold swatch hides selection outline; phone + sheet paints 12 icons gold.
Detector: 69 CLI findings (2 side-tab, 2 bounce-easing, 25 font-size, 21 radius, 19 color). Mostly intentional or scale drift. Real: sticker launcher dark-mode glow (ui/stickers.css:248); 10px text ×7; 15–20px sheet headings; 20px phone sheet radius vs 18px; dock-add second overshoot curve. False positives: Inter, cream palette, nested cards (columns), clipped canvas, zoom-button overflow (tooltip).
Overlay: injected on 5 views, no CSP block; servers stopped afterwards.

## Priority Issues
- [P1] Desktop bury has no feedback/undo: toast only `if (touch())` (ui/SelectionBar.tsx:53); keyboard path none (ui/shortcuts.ts:92). Fix: toast for all inputs and paths; optional bury motion. Command: harden, then delight.
- [P1] Errors speak HTTP: state/api.ts:39 falls back to res.statusText ("Bad Gateway"); sync badge truncates title; login error is a filled coral block. Fix: reassurance-first COPY, details in disclosure, icon-only phone badge, inline field error. Command: clarify + harden.
- [P1] Cards unreachable by keyboard/screen reader: tabIndex -1 (canvas/CardView.tsx:83); swatches named "collar/ball"; Restore labelled "Dig it back up"; note # → h1. Fix: roving tabindex, accessible card names, human swatch names, heading demotion. Command: audit → harden.
- [P2] Selection bar covers neighbouring cards; label popover covers its card; right-click replaced by single "Look here" (canvas/Canvas.tsx:1289). Fix: collision-aware placement; real card context menu; Look here only with others present. Command: layout.
- [P2] Too many equal-weight choices: 12-tool rail, 12 gold tiles in phone + sheet, 15-target phone selection sheet, two "Can edit" controls in Share. Fix: primary Note/To-do/Board, rest under More; gold only on primary; phone sheet Edit/Colour/Labels/Bury/More. Command: distill.

## Persona Red Flags
- Alex: no N/T/B keys or ? sheet; desktop Fetch blank until typing (hint touch-only, ui/Fetch.tsx:114); LOD view has no titles.
- Sam: can't Tab to cards; selection bar not a toolbar; sticky tooltips after focus return.
- Casey: Undo toast at top; top-bar actions out of reach; 6 unlabelled phone actions; new-note focus scrolls root 40px.
- Pip: cold empty board; "Shared space" jargon; stickers need Telegram link; "Bad Gateway" on blip.

## Minor Observations
- Sticker launcher glow in dark (ui/stickers.css:248).
- Off-scale sizes: 10px ×7, 15–20px sheet headings, 5/7/9/20px radii.
- Dock + overshoot (0.3,1.4,0.5,1) undocumented.
- Gold swatch hides selection outline in dark.
- Sync button filled gold with 0 changes waiting.
- Long to-do title scrolls start out of view while typing.
- Share stacks on open Buried bones panel.
- Account button dog face vs presence "RE".
- No match highlighting in Fetch.

## Questions to Consider
- Why does burying a card get no dog moment when board-tile hover does?
- Should Fetch be the single command surface?
- Does a 5–10 friend group need 12 tools?
- Should the gold swatch shift to butter/ochre?

Not reviewed: real offline, multi-user presence, agent proposals, admin, link/image/file cards, share viewer, phone dark, tablet.
