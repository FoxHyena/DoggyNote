# Assessment B — detector and browser evidence

Method: isolated Assessment B (`/root/avatar_critique_mechanical`). Assessment A's output was not consulted. Target: `apps/web/src/ui/AvatarEditor.tsx`, with `AccountMenu.tsx`, `Avatar.tsx`, `avatar.css`, and `avatarCrop.ts` as related implementation. Scope follows `.impeccable/surfaces/profile-photos.md`.

## Deterministic detector

Ran the bundled CLI scan **exactly once** for this refinement, from `apps/web`:

```sh
/Users/oreo/.agents/skills/impeccable/scripts/impeccable detect --json src/ui/AccountMenu.tsx src/ui/AvatarEditor.tsx src/ui/Avatar.tsx
```

Exit status: **0**. Raw stdout in `docs/qa/avatars/stationary-detector.json`: `[]`. **0 primary findings, 0 advisory findings, no rule names or file locations to report.** `detect --help` was consulted before the single scan; no scan was repeated. Earlier feature scans were not used as current evidence. Neither root nor `apps/web` had a critique ignore list.

## Browser method and evidence

Used automated Playwright Chromium and WebKit, with fresh isolated contexts against `http://127.0.0.1:5173`, logging in as `rex`. No CUA or native computer-control API was used. No profile photo was saved or removed; local image selection and Cancel were exercised. The first script explicitly blocked PUT/DELETE to `/api/me/avatar`; no blocked writes occurred. No data reset, board creation, or user-server shutdown was performed.

Fresh technical coverage: 12 combinations (both engines × 1440×900, 320×480, 720×480 × light/dark). Additional checks used the actual filechooser in both engines, real Chromium CDP multi-touch, and settled narrow-screen source-shape geometry. Existing `stationary-round-1/` contact sheets were inspected for account, saved options, normal cropping, panorama, and error states; these supplement the fresh nonmutating checks, especially save/error/remove states that were deliberately not repeated on the manual account.

Evidence directory: `docs/qa/avatars/stationary-mechanical/`.

- `evidence.json`: main browser matrix, ARIA snapshot, focus sequences, gesture and geometry results; 12 editor screenshots.
- `extra-evidence.json`: actual-picker focus and real multi-touch checks. Early immediate geometry readings in this file are superseded by settled readings below.
- **`stable-evidence.json`**: authoritative settled crop geometry and clean per-view overlay console evidence.
- `overlay-clean-{account,options,editor}.png`: clean overlay captures in separate fresh pages.
- `narrow-minimum-{panorama,portrait,square}.png`: minimum crop at 320×480.

The initial matrix measured options before its placement frame and records x/y=0 for those immediate measurements. That transient reading is **not an anchoring defect**. Clean settled desktop measurement is x=1171, y=128.5, width=200, height=54 beneath the avatar; the Account popover is x=1150, y=43.5, width=280, height=319. Existing phone/tablet captures show the anchored menu within screen bounds.

## Priority findings

### [P1] The photo editor does not receive initial keyboard focus

**Observed:** Selecting an image through the actual Add photo filechooser leaves `document.activeElement` on **BODY** after the editor and four sliders are visible, in both Chromium and WebKit. Direct local file input selection from an Account-focused state similarly leaves focus on the background Account button in all 12 matrix combinations. The first Tab enters the editor and subsequent Tab/Shift+Tab are contained, but the modal is not entered when it opens.

**Why it matters:** A screen-reader or keyboard user receives a visual modal without its focused control or dialog context. The existing trap cannot substitute for initial focus. This violates the contract's accessible-focus expectation even though later keyboard containment works. This review did not observe a board mutation from the unfocused state; the application's global shortcuts also guard open dialogs.

**Location:** `apps/web/src/ui/AvatarEditor.tsx:34` installs `installModalKeys(panel, close, closeButton)` without focusing anything; `apps/web/src/ui/agentDialog.ts` registers trapping listeners but never calls the supplied initial focus on installation.

**Fix:** Focus `closeButton` with `preventScroll` once the editor mounts (or a deliberately chosen focusable dialog heading), while retaining the current trap and return-to-avatar behavior. Add a targeted actual-picker assertion that focus is inside the editor immediately after opening, then verify Cancel/Escape restores avatar focus.

### [P2] A valid narrow-screen crop becomes too small to drag by touch

**Observed settled geometry at 320×480:** The stage is 190px square and reserves 88px around the fitted source. For the 2400×200 panorama, the initial 80% selection is approximately **6.8×6.8px**, shrinking to **2.125×2.125px** at the supported 25% crop. A 500×1000 portrait reaches **12.75×12.75px**; even the square source reaches **25.5×25.5px**. All four resize targets remain 44×44, hittable, on-screen and nonoverlapping. The issue is the tiny **move** target and nearly illegible circle/square guides, rather than the corner hit targets.

**Why it matters:** The displayed instruction promises “Drag the circle to position it,” but the only accepted initial movement area is the selection square (`down` rejects outside points). A phone user cannot reliably place a finger inside a 2px or 7px region. Keyboard arrows are a functional alternative on desktop, but their instruction is screen-reader-only and does not give a phone user an alternative.

**Location:** `apps/web/src/ui/avatarCrop.ts:8` fits the longest image dimension into `size - 88`; `AvatarEditor.tsx` starts movement only inside the selection square; `avatar.css:23` bounds stage size.

**Fix within the direction contract:** Preserve the stationary, fully fitted source and current nonoverlapping handles. When the displayed crop is too small to grab, expose compact labelled directional nudge controls, with an accessible position readout, and make the keyboard alternative discoverable on desktop. Do not autozoom or reframe the photograph to solve this. This is a meaningful edge-case usability limitation, not a request to undo the approved stationary-image model.

## Verified strengths and non-findings

- **Stationary photograph:** Canvas pixels remained byte-identical during crop movement and corner resize in all 12 runs. Board world transforms remained unchanged. Dragging outside the square left crop position unchanged. ArrowRight moved the crop right.
- **Touch isolation:** A real Chromium two-finger spread enlarged the selection (zoom parameter 1.25 → 1), while canvas pixels and board transform remained unchanged.
- **Resize geometry:** Four 44px outward targets remained individually hittable and nonoverlapping, including the minimum panorama, portrait and square selections. No target was clipped by the stage or viewport in the measured cases.
- **Dialog controls:** Footer remained on-screen at 320×480 (bottom 464px) and 720×480 (bottom 421.75px), with 44px-high controls. Existing first-refinement error captures retain visible error and footer controls.
- **Escape and return focus:** Escape closed photo options while keeping Account open and focusing the avatar; a second Escape closed Account. Cancel returned focus to the avatar in all 12 runs. Tab sequences stayed inside the editor once keyboard navigation began.
- **Semantics:** The editor has a named modal dialog, a described crop group, four individually named sliders with size range/value text, meaningful keyboard descriptions, named actions, and alert/status regions for error/busy states. Decorative avatar image hiding is appropriate where identity is already named. No unlabeled editor action was found.
- **Account structure:** Settled desktop width is 280px; identity uses the intended 56px avatar, 16px gap/padding, vertically centered username and separator. Existing captures support both themes and compact anchored photo options on phones.

## Browser detector overlays and false positives

Mutable injection was preflighted by changing the tab title and appending an executing script. The critique-only Impeccable live server started on port 8400. `http://localhost:8400/detect.js` was successfully injected into fresh pages labelled `[Human] Profile photo critique` for Account, photo options and editor. Each waited 2.8 seconds; the detector ran and overlay elements were present (four nodes for two finding decorations). Screenshots provide the presentation evidence.

**Authoritative clean console results:** Each of the three views reported **2 element groups**, both outside the profile-photo target:

| Rule | Element | Browser detail | Disposition |
| --- | --- | --- | --- |
| `low-contrast` | `p.empty-sub` on the underlying empty canvas | 4.3:1 versus 4.5:1, text `#a69d93` on `#3d3934` | Existing board empty-state content, including behind the modal/scrim; not a profile-photo finding. No editor text was flagged. |
| `text-overflow` | `button.icon-btn[data-testid="zoom"]` | Reported overflow by 29px | Existing canvas zoom control outside this refinement. Do not attribute it to avatar menus or editor controls. |

An earlier repeated injection in a reused page produced noisy page-wide palette/animation/empty-state signals; those screenshots and initial logs remain raw evidence only and are superseded by `stable-evidence.json` and `overlay-clean-*`. The page palette flag is not grounds to replace the approved Warm Den tokens. Mobile supplementary logs likewise identify existing empty-canvas/zoom/animation content, not profile controls. None of these signals explains or detects the two interaction findings above.

There is **no persistent user-visible Human tab**: this review used headless automated browsers to honor the user's no-native-control direction, and all review contexts were closed. Say that overlays were captured, not that a live overlay remains visible in the user's browser.

## Run notes

- Assessment independence: B only; no Assessment A artifact or findings read, and no B findings sent to the parent before completion.
- CLI detector: single completed scan, exit 0, raw JSON retained; no rescans.
- Ignore list: none at root or app critique location.
- Browser fallback: initial sandbox browser launch failed with macOS Mach-port permission denial. The isolated automated browser then ran successfully through the authorized shell escalation. No CUA/native APIs were used.
- Live server: initial sandbox startup timed out; the successfully started critique server was PID 60349 on port 8400. It was stopped with `impeccable live-server stop --keep-inject`, output “Stopped live server on port 8400.” No entry-file injection or source edits were made. User Vite/API servers were left running.
- Overlay: mutable preflight and injection succeeded; clean three-view console evidence and screenshots retained. Browser visibility is headless; no persistent live presentation claimed.
- Cleanup: all Playwright contexts/browsers closed; four temporary review/script files removed. QA JSON/PNGs intentionally retained. One supplemental script initially timed out on measurement of an absent options node; its corrected run completed, and stable results are explicitly designated above.
- Scope limitations: no fresh save/remove/network-error operation on the manual user's photo; reviewed first-refinement captures and source for those states. No full test suite or native walkthrough was run by Assessment B.
- Questions skipped: implementation approved; issues are to be fixed autonomously by the parent within authorized scope.
