Method: isolated Assessment A (design review; detector output neither run nor read).

# Stationary profile-photo refinement — Assessment A

## Design specificity verdict

The implementation belongs in DoggyNote. Warm neutral surfaces, system type, compact rows, Phosphor icons and one amber Save photo action preserve the Warm Den. The account identity now uses the user's preferred Telegram hierarchy: a substantial round avatar, one centred username, camera feedback, and a small anchored action menu. The earlier loose inline Add photo link is gone. The editor now expresses the requested physical model: the whole photo stays still while a square and circular guide move together. This is a substantial correction of the supplied counter-evidence, not a reason to rubber-stamp the remaining details.

The biggest remaining gap is the difference between a mathematically valid tiny selection and a usable touch control. Small-source crops preserve the contract but need a separate way to move them.

## Design health

| # | Heuristic | Score | Evidence / remaining issue |
| --- | --- | --- | --- |
| 1 | Visibility of system status | 3 | Loading, Saving…, errors and the updated avatar are represented. Removal has an accessible status. |
| 2 | Match with the real world | 4 | Camera → Add/Change/Remove and stationary-photo framing match the supplied reference. Plain instructions describe the action. |
| 3 | User control and freedom | 3 | Reset, Cancel, close and Escape are present; crop and file remain on upload failure. Live Cancel returned to Account and focused its avatar. Tiny touch movement remains difficult. |
| 4 | Consistency and standards | 3 | Account and editor fit existing themes and components. The crop-stage focus outline is visibly cut off at its bottom. |
| 5 | Error prevention | 3 | Crop bounds, 25–100% range, file validation and disabled save during upload prevent common mistakes. |
| 6 | Recognition rather than recall | 3 | Camera cue and text menu are discoverable. At extreme crop sizes the four corner glyphs become one cross. |
| 7 | Flexibility and efficiency | 3 | Mouse, touch/pinch and keyboard movement/resizing are implemented, with larger Shift steps. Tiny movement still depends on a keyboard or extraordinary pointer precision. |
| 8 | Aesthetic and minimalist design | 3 | Balanced account row, calm editor and one primary action. Tiny crossed guides and clipped focus ring undermine finish. |
| 9 | Error recovery | 4 | Error is plain and local, retains the crop, provides immediate retry, and leaves the footer visible at narrow and short sizes. |
| 10 | Help and documentation | 3 | Short contextual pointer instructions and accessible movement/resize hints. No need for a larger help surface for this small task. |
| **Total** | | **32/40 — Good** | **Fix the tiny touch target before treating the supported source-shape range as complete.** |

## What's working

1. **The account hierarchy is repaired.** The live desktop menu measured exactly 280px wide. Its 56px avatar and 15px semibold username share a balanced row, followed by a separator. Camera feedback and the anchored 200px menu feel coherent in both themes and on phones.
2. **The framing model matches the request.** Source-coordinate crop geometry and a separate image projection keep the photo stationary. The 80% centred default, outward corner targets and visible square/circle relationship make ordinary photographs understandable without a zoom slider.
3. **The failure path respects the user's effort.** The error captures retain the framing, state what to do, and keep Save photo available above the screen edge. Returning to Account makes the updated avatar the completion signal.

## Priority issues

### P1 — A tiny crop can be resized but cannot reliably be moved by touch

The supplied panorama captures show all four visible corners merging into a white cross. In a fresh isolated Chromium context, a 2400×200 source at 25% crop produced a **6.28125px** square on desktop and a **2.125px** square at 320×480. The four outward resize targets remain 44px, but movement starts only inside that tiny square. A finger cannot reliably hit a 2px movement region. This is a real interaction gap even though the geometry and hit-area tests pass.

**Fix:** When the rendered selection is smaller than a usable touch region, expose a separate 44px **Move crop** grip, connected by a short leader to the true selection. Keep its target disjoint from all four resize targets, and have it move the same crop in source coordinates. Preserve the full stationary image, the true square/circle position and the rule that dragging arbitrary outside space does nothing. Reduce corner-mark length or place marks outside with leaders so they cannot merge into a cross. A magnified noninteractive result preview is optional; it is not necessary to fix movement access and should not complicate the minimum correction.

Evidence: `stationary-round-1/webkit/narrow-dark-panorama.png`, `stationary-round-1/chromium/narrow-light-panorama.png`, and live `stationary-design-live/panorama.png`. Relevant code: `AvatarEditor.tsx` pointer-start containment, handle markup; `avatar.css` handle glyph styling. Suggested command: `$impeccable harden`.

### P2 — The crop-stage keyboard focus ring loses its bottom edge

The Chromium framed captures show an amber outline with top and sides, ending abruptly at the bottom corners. The stage uses an outside outline while its scrolling body has only horizontal clearance. This looks like a broken boundary around the current keyboard target and reduces confidence in which area owns the arrow keys.

**Fix:** Reserve enough clearance on every side inside the scrolling body, or draw an inset focus ring on the stage. Verify the complete boundary at desktop and short-window sizes without moving the pinned footer.

Evidence: `stationary-round-1/chromium/desktop-light-framed.png` and `short-dark-framed.png`. Relevant code: `avatar.css:20`, `avatar.css:26`. Suggested command: `$impeccable polish`.

### P3 — Transparent pixels read as an unexplained dark or grey fill

The transparent-source captures display the clear half of the source as a flat shaded region. A person choosing a transparent drawing cannot distinguish image colour from empty pixels until the result is used elsewhere. The circle guide itself remains visible, so this is polish, not a release blocker.

**Fix:** Add a restrained warm checkerboard beneath the photo canvas, clipped to source bounds and kept out of the export, or show a small neutral result preview when transparency is present. Keep the existing guide/shade materials and avoid a conspicuous new decorative pattern.

Evidence: `stationary-round-1/webkit/desktop-dark-transparent.png` and `narrow-light-transparent.png`. Suggested command: `$impeccable clarify`.

## Before / After / Why

| Before | After | Why |
| --- | --- | --- |
| A 2.125px move region with four visible corner marks collapsed into a cross | Conditional 44px Move crop grip with leader; noncolliding corner marks; unchanged stationary photo | Makes the supported tiny crop operable on touch without changing crop semantics. |
| Outside stage focus outline clipped by the scrolling body | Complete outline with vertical clearance, or an inset ring | Makes keyboard ownership clear and removes the unfinished border. |
| Clear pixels appear as a solid dark/grey patch | Quiet checkerboard under source bounds, or a restrained result preview | Lets people distinguish transparency from painted content before saving. |

## Cognitive load

**Editor: low (0 checklist failures for ordinary sources; 1 recognition/hierarchy failure for extreme tiny crops).** One photo task, one instruction, one primary Save action. Reset / Cancel / Save is a group of three; the four identical handles form one spatial operation rather than four unrelated decisions. No memory bridge or extra configuration is required. The tiny cross defeats the otherwise clear instruction to drag the circle.

**Account: moderate by the checklist (2 failures: chunking and minimum choices).** The admin account exposes seven visible actions if avatar options and Appearance are counted alongside Manage people, Agent connections, Guides, About and Sign out. The captured nonadmin account has six. These are familiar navigation destinations and the identity separator gives useful structure, so this is a low-priority existing account-menu concern; do not expand this refinement into a navigation redesign. The photo submenu has one or two options and uses progressive disclosure correctly.

Checklist: single focus passes; chunking passes in editor / fails in full Account list; grouping passes; hierarchy passes except tiny crop; one thing at a time passes; minimal choices passes in editor / fails in Account; working-memory demand passes; progressive disclosure passes.

## Emotional journey

The entry is calmer than the supplied old account capture: the avatar is the clear affordance, rather than a loosely aligned text link. Ordinary framing is direct and reassuring because the source remains visible. The emotional valley is an extreme crop where the visible circle disappears into crossed marks and touching it is unreliable. Upload failure is handled well: the work remains in place and retry is immediate. The ending is strong because Account returns with the new identity image; live Cancel also restored focus without disturbing the user's stored profile.

## Persona red flags

- **Jordan, first-time user:** Camera and Add photo now provide a recognizable path. For a panoramic source at small crop size, the instruction “Drag the circle” names a circle that is no longer distinguishable. The conditional move grip should use an obvious move icon and accessible label.
- **Sam, keyboard / low-vision user:** Source includes labelled movement and resize operations and Shift acceleration. The clipped stage focus ring is the concrete visible defect. This review does not claim a VoiceOver or 200% browser-zoom test.
- **A friend updating a shared-board identity on a phone:** The 56px avatar and anchored menu work at 320px and keep account context. A finger cannot precisely start movement in the 2.125px panorama selection, so a separate target is required for this supported edge case.

## Minor observations and questions for the implementation pass

The photo submenu temporarily covers Appearance and Agent connections; this is normal for an anchored contextual menu and matches the reference. Do not solve it by restoring inline links or adding another phone sheet. The large quiet mat around unusually shaped sources follows the whole-photo constraint; avoid compensating with automatic photo zoom.

Can the tiny-selection move affordance remain a single conditional control instead of another editing toolbar? Can its visual leader explain the relationship without needing more text? A lens is useful only if people still cannot judge the result after movement access is fixed.

Questions skipped: the user approved implementation and authorized autonomous resolution of review findings.

## Assessment evidence and limits

Read `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`, `apps/web/.impeccable/surfaces/profile-photos.md`, the four requested implementation files, relevant Popover code, the critique scoring/persona reference and Emil review format. No ignore file exists at `apps/web/.impeccable/critique/ignore.md`. Reviewed all 22 supplied contact sheets and full-resolution representatives across ordinary crop, account/menu, errors, short-window focus, portrait, panorama and transparent states. Reviewed all four supplied user references. No Assessment B output was read, and no detector was run.

Live browser verification used a new headless Chromium context at `http://127.0.0.1:5173`, signed in as rex, opened Account/options, loaded a temporary local panorama, resized via keyboard, changed viewport, and cancelled. It performed no profile save/remove or local-data reset. Cancel returned to Account with `photo-options-trigger` focused. The context/browser were closed. Sandbox launch initially failed with Chromium MachPort permission denied; an approved escalated browser launch completed. No server was started. Two live captures are retained under `stationary-design-live/`; temporary duplicate PNGs were removed. No source files were edited. Static and live browser evidence do not replace physical-device touch or assistive-technology testing.
