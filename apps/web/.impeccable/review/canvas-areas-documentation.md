# Canvas areas documentation

Outcome: ordinary production extension of the incumbent Warm Den system. Preserve `apps/web/DESIGN.md` and `apps/web/.impeccable/design.json` unchanged. No new palette, type family, shared token, visual world, or system-wide rule is required. This record documents design evidence; it does not establish functional release completion.

## Evidence checked

Read the documenter operating reference and role instructions, `PRODUCT.md`, the canvas-areas direction contract, incumbent `DESIGN.md` and sidecar, and the finish review with its `ship` disposition. Inspected `AreaCard.tsx` and `area.css` in full; sampled the area integration in `canvas/Canvas.tsx`, `canvas/CardView.tsx`, `ui/Toolbar.tsx`, `ui/SelectionBar.tsx`, and `ui/CardContextMenu.tsx`. Checked the global type, focus, card, colored-card and responsive styles in `index.css`, the paired theme definitions and card-color normalization in `packages/theme/src/tokens.ts`, and the 48px area-header constant in `packages/core/src/areas.ts`.

Opened all eight final refreshed `canvas-areas-*.png` captures in this review directory: desktop-dark, desktop-light, collapsed-light, add-menu-light, phone-dark, phone-light, tablet-dark and tablet-light. They match the current quiet tinted frame and ordinary theme text. Desktop and tablet retain the established rail; phone retains the bottom dock, visible Add to area and Area actions, and independently positioned member content. The collapsed light capture hides contents and retains the projected dashed connection; the add-menu capture retains the shared shelf menu grammar. Right-hand world-space overflow on touch follows the contract rather than shrinking card content. Static captures do not establish interactions, focus, hover, animation, persistence, or release readiness.

The parent refreshed these captures after identifying that a regression run had overwritten them with an earlier production build. This pass reopened every refreshed file and resolved the initial full-Sky-fill/source mismatch. The superseded full-swatch appearance is excluded from this documentation outcome.

## Source-to-system comparison

| Established system | Final source evidence | Documentation decision |
| --- | --- | --- |
| Warm paired canvas and content colors; One Lamp, Twin and No Hex rules | Area defaults mix the panel token with transparency; colored areas mix 12% of `--c-bg` into `--dn-bg` and retain `--dn-text`. CardView uses the existing card-color variables. Global colored-card styling explicitly excludes areas. | Keep incumbent tokens and amber attention roles. A content swatch tint does not become a new chrome accent. |
| Native system typography; 600 emphasis | Area title uses 16px/600; header actions and empty hint use 12px. Ordinary member-card typography is inherited. | Use existing title/caption roles; no new type ramp. |
| Flat working plane and quiet rounded boundaries | Area has a 1px border, 12px corners and no shadow in either theme. Area is behind content at z-index −1. | Area is a local grouping surface, not a floating panel or a global change to card corners. |
| Shared menu and control grammar | Header uses existing BarMenu, bar-button, column disclosure and Phosphor Icon components. Add to area lists existing content tools. | Reuse existing menu, icon and focus guidance; no new component primitive is needed in the sidecar. |
| World-space content measurements on touch | Canvas/CardView retain world placement; header follows the visible portion of a large frame. Coarse-pointer actions and disclosure have 44px targets. At narrow header widths, Tidy is hidden in the header and remains in Area actions. | Keep the Measured Card rule. Offscreen world content is handled by canvas navigation, not responsive card reflow. |
| Restrained functional motion | No area entrance choreography is introduced. | Preserve incumbent motion guidance. |

## Local behavior recorded

Area sits immediately after Column in the creation tools. The selection bar exposes Create area for eligible multi-selection; the card context menu also supports wrapping an eligible sole item. The group retains ordinary workflow columns and independently positioned context, using the existing canvas rather than another camera or nested board. Header actions provide explicit Tidy and Add to area. Area actions distinguish Remove area, keep contents from Bury area and contents. These are surface behavior facts, not new system-wide prohibitions or design tokens.

## Five-line system summary

1. Palette: warm dark and oat light grounds, existing card swatches, sparse amber attention; One Lamp, Twin and No Hex remain authoritative.
2. Type: inherited system sans, established 22/16/14/13/12/11px hierarchy; area title uses 16px/600 and supporting controls 12px.
3. Layout: one dotted world plane, flat grouping behind ordinary cards, stable member positions and existing pan/zoom.
4. Form: restrained 1px outline and 12px area corners; familiar floating menus and touch-sized header actions.
5. Rules: preserve 600 emphasis, Measured Card and Flat Floor; keep area-specific geometry and behavior in this surface record.

## Not canonized or repaired

Pre-existing sidecar drift remains: its component snippets draw older 24×24 icon geometry while current DESIGN.md requires upstream Phosphor assets, and its pop-in motion entry includes Fetch while current DESIGN.md states Fetch appears immediately. The incumbent Flat Floor prose also coexists with its explicitly documented light-theme paper edge and sticker exceptions. This local extension does not authorize a system refresh, so none is repaired or promoted into a new rule. No new craft-floor defect was found in the sampled area source or refreshed captures.
