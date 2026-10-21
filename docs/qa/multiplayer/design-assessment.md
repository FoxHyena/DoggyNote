# Independent design assessment — DoggyNote multiplayer

Assessment A by `/root/impeccable_design`. Mode: Operate. Reviewed source and all 12 supplied round-1 PNGs through `view_image`; no detector output or other reviewer findings were consulted. The computer-use inventory exposed no enabled browser, so independent live browser interaction was unavailable. Screenshots are browser evidence supplied by the implementation run, not a substitute for keyboard or assistive-technology testing.

## Verdict

The desktop extension feels native to DoggyNote: warm surfaces, a compact people control, thin selection outlines, and small named cursors leave the board in charge. It is specific to the existing product rather than a generic collaboration dashboard. The main remaining gaps concern the temporary attention signal and continuity for keyboard users, rather than visual direction. No P0 identified. One P1 and two P2 findings need attention.

## Priority findings

1. **P1 — “Look here” is unavailable to nonvisual participants.** The complete ping overlay is inside `aria-hidden="true"` (`apps/web/src/ui/Collaboration.tsx:52–61`), and received events only update the visual list for three seconds (`apps/web/src/state/realtime.ts:130–132`). Neither receipt nor the pointed object/location has an accessible equivalent. A screen-reader user can send a ping through the people menu, but cannot receive its meaning. Add a brief polite announcement of who pointed where, preferably naming a selected card where available. Keep passive pointer motion silent. This is a source-confirmed accessibility gap; the screenshots do not exercise a ping.

2. **P2 — An off-screen ping provides no useful cue.** Pings use raw world-to-screen coordinates inside the clipped overlay (`Collaboration.tsx:48,52,61`; `collaboration.css:21`). If a friend points beyond the recipient’s viewport, the signal expires without any visible indication. This is particularly likely when a phone views a desktop board: all four phone PNGs already show most of the remote note beyond the right edge. Preserve the user’s camera, but show a small edge cue or unobtrusive “fido pointed to…” affordance that lets the recipient choose to reveal the target. A sender confirmation would also reassure users when the selected card is off-screen. This behavior is inferred directly from rendering and expiry logic, not reproduced live.

3. **P2 — Activating a people-menu action removes keyboard focus.** Both Follow and Look here close the menu while their button has focus (`Collaboration.tsx:34,37`). `installMenu` restores focus only on Escape (`apps/web/src/ui/menu.ts:12–13`); these action handlers do not move it to the trigger or follow controls. Keyboard users lose their position after a successful action. Restore focus to the people trigger after pinging, and deliberately choose trigger or Stop following after following. The existing Escape and arrow-key implementation is a good base. This is a source-based finding requiring keyboard confirmation.

## Evidence and strengths

- `round-1/chromium-light-people.png`, `chromium-dark-people.png`, `webkit-light-people.png`, and `webkit-dark-people.png`: the menu has a clear identity → activity → action hierarchy. The divider separates the group action from individual people. Colour reinforces names rather than being the only identity cue. Both themes preserve the incumbent palette from `packages/theme/src/tokens.ts`.
- All four desktop `*-following.png` files: the compact top-centred banner gives immediate, plainly labelled control. It does not cover the working notes in this composition. Source also exits on manual canvas input or Escape (`realtime.ts:146–147`) and when the leader leaves (`realtime.ts:40–41`).
- Cursor/selection labels stay screen-sized across zoom; preview outlines are dashed, ordinary remote selection is thin, and all overlays ignore pointer input. Coarse-pointer targets reach 44px and reduced-motion preferences disable cursor transitions/ping animation (`collaboration.css:38–41`). These are practical, quiet details.

The four phone captures show translucent, partially lowered sheets. `apps/web/src/ui/mobile.css:396–398` explicitly animates from translated/transparent, so these frames cannot establish a persistent contrast, overlap, or bottom-clipping defect. A settled capture is required before judging phone sheet composition. The final mobile sheet uses the incumbent global mobile rules (`mobile.css:284–303`), which override the top-right positioning in collaboration.css. No settled phone-follow banner, long name, disconnected state, or crowded-board screenshot was supplied.

## Heuristic scores

Scores describe the reviewed collaboration surface, with source-based limitations above.

| Heuristic | Score / 4 | Evidence |
|---|---:|---|
| Visibility of system status | 2 | Live/reconnecting and following are explicit; pings can be imperceptible. |
| Match with the real world | 4 | People, Follow, Look here, and editing status are natural language. |
| User control and freedom | 3 | Explicit stop, Escape, manual-camera exit; focus continuity needs repair. |
| Consistency and standards | 3 | Incumbent tokens/menu styling; action-close focus behavior incomplete. |
| Error prevention | 3 | Ping disabled while disconnected; follow ends when leader disappears. |
| Recognition rather than recall | 3 | Named participants and inline ping explanation; off-screen attention has no cue. |
| Flexibility and efficiency | 3 | Keyboard menu and context ping plus people-menu alternative. |
| Aesthetic and minimalist design | 4 | Restrained desktop composition with no competing collaboration chrome. |
| Error recovery | 3 | Automatic reconnect and reassuring fallback; no data-entry burden. |
| Help and documentation | 2 | Ping explained inline; follow behavior/termination undisclosed. |
| **Total** | **30 / 40** | **Good** |

## Cognitive load and emotional journey

Low cognitive load in the supplied two-person state: all eight checklist items pass (single focus, chunking, grouping, hierarchy, one decision at a time, minimal choices, working-memory continuity, progressive disclosure). The menu presents one relevant person action and one group action. With five or more remote people the repeated Follow choices exceed four visible actions, but remain meaningfully grouped by named person; a bounded scrolling list exists. Do not add more top-level controls to solve the findings.

Seeing a familiar name and editing outline is reassuring; following has a satisfying explicit end control. The emotional valley is an attention request that seems to vanish, especially across unequal viewport sizes. Preserve camera autonomy while making that request perceptible.

## Persona flags and minor observations

- **Sam, keyboard/screen reader:** cannot receive pings; action-close focus continuity is incomplete. Global focus-visible styling and menu arrow/Escape support are strengths.
- **Casey, interrupted phone user:** uses a much smaller view than a desktop collaborator and can miss their ping. Settled phone screenshots remain necessary; transient animation frames cannot establish release readiness.
- **Jordan, first-timer:** the ping hint is helpful; a short follow explanation could clarify that the camera tracks another person and manual movement exits. Treat this as optional P3 copy polish, not a reason to add onboarding.

No source edits made.

Questions skipped: user already authorized the implementation and required quality fixes.
