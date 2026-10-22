# Fewer equal-weight choices

Item 6 of the Warm Den critique backlog. Reviewed with Impeccable layout/distill/polish guidance and Emil design-engineering principles against `apps/web/DESIGN.md`.

| Before | After | Why |
| --- | --- | --- |
| Equal-weight desktop tools and twelve gold phone tiles | Note, To-do and Board lead; Note alone has the accent | Common tasks have a clear starting point |
| Phone Add switches from centred three-column tiles to left-aligned two-column rows | One three-column catalogue of identical 44px inline icon-and-label buttons; first row weight 600, remaining tools quiet | One action type has one button layout and column grid; all twelve choices remain visible |
| A board selection exposes colours, Open, Rename, eight icons and actions at once | Five contextual actions plus Done; palettes and secondary actions in focused sheets | Keeps the board visible and preserves 44px targets |
| Small palettes spread across a tall sheet; selected tile nearly meets its heading | Centred 212px four-by-two grid, 44px targets, 4px row gaps and 12px header-to-tile gap; selected icons have an outline | Removes excess space while measuring separation from the full selected tile |
| Separate invitation permissions, flat section spacing and empty lists | One new-invitation permission; 16px section / 8px internal gaps; populated access lists only | Makes scope and grouping clear |
| Full-width phone permission field and platform arrows close to the edge | Compact label/control row; equal 12px text/caret insets inside the border | Corrects the internal balance without expanding the control |
| Repeated privacy and checkbox explanations; Create link stays gold during a username invitation | Shorter task copy; inherited access and expiry consequences retained; Invite becomes primary while typing a username | Keeps one primary action aligned with the current task |

Phone Add measures about **273px**, down from 426px in the first refinement (473px before review). Colour and Board icon measure **177px**, down from 193px (237px before review). The private edit-invitation sheet measures about **462px**, previously about 565px. All ordinary touch targets remain at least 44px. Add and palette grips retain their 28px height in a centred 96px target, sharing only the noninteractive space above the heading text. The selected icon uses an outline; mouse hover uses only a neutral fill.

Design pass: inspected dark/light iPhone Add, Colour, Board icon and Share plus desktop Share. The final composition uses the app's existing bar-button grammar and aligned columns. Removed the old large-tile and last-child grid exceptions rather than layering more partial overrides. Geometry checks sample the heading and tile in one renderer frame so entrance motion cannot distort the measured gap. Both 320px and default phone widths keep all Add labels readable.

Sharing uses 16px gutters and a compact 128px native select beside its label (36px desktop / 44px touch). A single Phosphor caret replaces the platform arrows; text and caret each sit 12px inside the border. The native picker and keyboard interaction are retained. Existing members and links are separate from new invitations. The inherited-access explanation waits for loaded access data. Scrolled headers paint an opaque strip across the panel, and the phone close control stays below its grip; the existing visual-panel and phone gesture regressions verify both conditions.

The branch includes main `6152b6bf` (#69/#70): immediate Add reopening, explicit grips, native body scrolling, cancellation and focus return remain intact. No card typography, padding, measurements, API contracts, canvas transforms or performance budgets changed. The prior canvas check remains 16.7–16.8ms p95 with a 13MB JS heap.

Screenshots are captured with temporary Playwright specs, removed before commit. Dark/light Add, Colour, Board icon and Share captures are refreshed; creation/selection/More captures remain valid. PNGs are embedded in the PR using their committed SHA.

Validation: `pnpm typecheck` and all 312 unit tests pass. The previous full Chromium/WebKit/iPhone/Pixel matrix passed 125 functional cases with one intentional platform skip; both dark/light screenshot capture cases also passed. The matrix includes 320px Add alignment and label bounds, palette target and header gaps, explicit grip cancellation/dismissal, rapid Add reopening, reduced motion, keyboard focus, populated sharing/export/dialog layouts and scrolled Share header/close separation. The previous CI Share header failures are reproduced by the unchanged regression tests and now pass in both engines. The layout detector reports zero findings. Temporary capture specs are removed before commit.

Permission follow-up: inspected refreshed dark/light desktop and iPhone Share captures. The control remains 128px wide at 320px and standard phone widths, vertically aligned with its label, with balanced internal insets and a 44px touch target. Native type-ahead, invitation permissions, populated-panel scrolling and phone grip/close interactions are covered by the browser checks.
