---
version: 1
slug: "canvas-areas"
primary_target: "apps/web/src/cards/AreaCard.tsx"
related_targets: ["apps/web/src/cards/area.css", "apps/web/src/canvas/Canvas.tsx", "apps/web/src/ui/Toolbar.tsx", "apps/web/src/ui/SelectionBar.tsx"]
---

# Canvas areas

Mode: Operate. Production extension of the existing board. User approved spatial areas containing workflow columns and free context, plus manual planning arrows. The alternate sections and tabs remain in the development playground.

## Direction contract

THESIS: Make projects visible as movable canvas areas while columns retain workflow meaning and notes retain their own readable positions.

OWN-WORLD: Preserve DoggyNote's warm dotted canvas, system typography, theme tokens, Phosphor icons, existing editors and menus. Areas use restrained tinted boundaries behind ordinary content, never an additional camera or nested board.

STORY: Create an area or wrap a selection; drop items inside, move by the header, resize the minimum boundary, and connect with existing Line controls. Add to area reuses existing content tools. Tidy is explicit. Collapse hides contents and projects connections; default removal keeps contents, with separate family burial.

FIRST VIEWPORT: Existing board chrome and toolbar remain. Area appears beside Column. The area title and restrained grip establish the group; ordinary cards and arrows remain the visual focus. Phone and tablet preserve world-space card sizes, use existing pan/pinch and docked controls, and have touch-sized header actions.

FORM: Local extension of the approved canvas concept. No concept seed. Signature interaction is dragging the header to carry mixed members and attached arrows without changing their relative placement. No entrance animation. Minimum frame plus member bounds grows without rearranging content or rewriting member positions.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
