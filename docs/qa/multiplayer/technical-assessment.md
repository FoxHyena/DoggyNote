# Assessment B: technical and browser evidence

Reviewer: `/root/impeccable_evidence`. Assessment B remained isolated from Assessment A until the parent explicitly sent “Assessment A finished; run detector now”. No app source was edited. This is a pre-correction snapshot, not a claim about later fixes.

## Scope and method

Reviewed `apps/web/src/ui/Collaboration.tsx`, its CSS and menu helper, changed `Canvas.tsx` and `NoteCard.tsx`, and `state/realtime.ts`, using `apps/web/PRODUCT.md` as product context. Native Paseo browser inspection used a fresh independent tab `994a8e81-5fbb-4a6d-aace-6994f97c97e0` at `http://localhost:5217/`, sharing the already authenticated local browser session. Desktop viewport: 1440×1000; phone-sized viewport: 375×812. The latter is viewport resizing on a desktop pointer, not real-device touch emulation (`pointer:coarse` was false).

Screenshots: [desktop](technical-desktop.png), [phone people sheet](technical-phone.png). Both were captured before detector injection.

## Deterministic scan

Executed exactly once, after the Assessment A gate:

```sh
node /Users/oreo/.claude/skills/impeccable/scripts/detect.mjs --json apps/web/src/ui/Collaboration.tsx apps/web/src/canvas/Canvas.tsx apps/web/src/cards/NoteCard.tsx
```

Exit status **0**, **0 findings**, JSON `[]`, saved in [detector.json](detector.json). There are no CLI rule names or source locations to report. This clean result does not cover dynamic geometry or collaboration accessibility.

## Browser detector visualization

Mutable preflight succeeded: setting/restoring `document.title` worked and appending/removing a nonexecuting script tag worked. The ordinary sandbox background server attempt timed out; an approved local background invocation then started PID 52185 on port 8400. The tab title was labeled `[Human]`, the page scrolled to top, and `http://localhost:8400/detect.js` was injected. Its load event succeeded and the script ran after a 2.5-second wait. No CSP changes were made. Native browser tools expose no explicit present-tab action, so presentation was not separately invoked.

Console output reported **4 element groups containing 5 rule findings** (the body group has two findings):

| Rule | Browser attribution | Assessment |
|---|---|---|
| `clipped-overflow-container` | `main.stage` clips a positioned child | Expected canvas clipping, not evidence of a defect. Remote geometry may deliberately extend outside the viewport. |
| `gpt-thin-border-wide-shadow` | Mobile sticker launcher: 1px border plus 16px shadow blur | Incumbent visual-style advisory outside this multiplayer change. |
| `text-overflow` | Zoom `button.icon-btn`, 34px overflow | False positive for the button's tooltip pseudo-element; visible `100%` and caret fit. Other tooltip buttons also have scroll widths larger than their boxes. |
| `flat-type-hierarchy` | Body font sizes 10, 11, 12, 14, 16px, ratio 1.6:1 | Generic advisory on an operating UI, not a requirement for editorial display typography. |
| `layout-transition` | Body-level aggregation, `transition: width` | Requires attribution before action; not demonstrated as a multiplayer performance regression. |

Confirmed actual `.impeccable-overlay` nodes: three element outlines with labels, plus a banner holding the two page advisories. [browser-detector.json](browser-detector.json) preserves console and network output. The detector server was stopped using `node /Users/oreo/.claude/skills/impeccable/scripts/live-server.mjs stop`; it reported stopped, with a harmless missing-config warning about source-tag cleanup. A subsequent process check found no surviving matching server process. The review tab was closed to remove its injected DOM.

## Actionable manual findings

1. **P2 — Selected column cards ping the wrong position; selected stickers are ignored.** `state/realtime.ts:58–59` centers the stored `doc.getCard()` coordinates. Cards inside columns have displayed world positions derived by `canvas/layout.ts:65` (`rectOf`), rather than their stored free-canvas coordinates. Selecting a sticker produces no card and falls back to the viewport center. This contradicts “Point out your selected card”. Resolve the first selected object's `rectOf` and center that rectangle, with viewport center as fallback. This is source-confirmed; a column/sticker ping was not exercised interactively.

2. **P2 — Incoming pings have no accessible equivalent.** `Collaboration.tsx:52` marks the whole overlay `aria-hidden`, including the attention request at line 61. The people menu reveals editing activity but no received ping. Screen-reader users cannot perceive a teammate's “Look here” request. Keep decorative pointers hidden, and provide a concise polite announcement for incoming pings with sender and useful location context. Avoid announcing continuous pointer movement.

3. **P2 — Connection changes are not announced.** `Collaboration.tsx:29` renders “Live”/“Reconnecting…” in an ordinary span only while the menu is open; the collapsed trigger's accessible name only reports the participant count. A user relying on assistive technology cannot learn a live-presence outage without reopening the menu and reading it. Include connection state in accessible trigger text or a restrained live status region. Durable save status should remain distinct from live-presence state.

## Positive and bounded evidence

- Desktop menu fits within the viewport; the phone layout inherits the established bottom sheet and fit 375px with no document horizontal overflow. Long participant names have wrapping, and remote labels have truncation.
- The trigger and follow buttons are native buttons with accessible labels; focus visibly appears on keyboard focus. Escape closed the menu and restored focus to the trigger in the inspected browser. Additional native keypress activation/arrow-navigation results were inconclusive because focus moved unexpectedly through the automation path, so this report makes no full keyboard-conformance claim.
- Coarse-pointer rules raise the people trigger, follow action, and stop-follow action to 44px minimums. Phone-sized desktop-pointer measurements were 36px for the trigger and 32px for follow; those do not invalidate the explicit coarse-pointer rule. A real touch device was not tested here.
- Reduced-motion CSS disables remote-cursor interpolation and ping animation. Received camera follow updates are direct rather than animated.
- Existing Canvas viewport culling and LOD remain in place. Presence sends are throttled to approximately 75ms, selection/preview payloads are capped at 100 objects, and ping lifetime/count are bounded. No measured large-board performance benchmark was run, and no new performance failure was confirmed. Remote outlines/previews are clipped by the overlay but not geometrically culled; this is a scaling observation, not a proven defect for the stated small-group audience.
- Note editing still loads CodeMirror dynamically; awareness is disposed on editor cleanup. Composition-specific correctness and durable concurrent merging require the parent's dedicated functional tests and were not inferred from static UI inspection.

Questions skipped: delegated Assessment B supplies evidence to the parent critique; user-facing questions belong to the combined critique.
