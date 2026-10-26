# Column grouping concepts

Run `pnpm --filter web dev --host 127.0.0.1 --port 5196 --strictPort`, then open [the playground](http://127.0.0.1:5196/concepts.html). It is a separate development entry, with synthetic examples and its own local storage. It does not read, write, or migrate real boards. Normal production builds do not include this page.

The user wants groups for both projects/areas and workflow stages. The shared example uses **Weekend away** and **Home projects**, each containing **Ideas**, **Planning**, and **Ready** columns.

| Concept | Organization | Tradeoff |
| --- | --- | --- |
| **Canvas areas — preferred** | Named boundaries move related columns together. Columns keep their own spatial offsets; Tidy aligns them. | Free placement needs room and occasional tidying. |
| Board sections | Each project occupies a row; its workflow columns align automatically. | Less freedom of placement; larger boards need scrolling. |
| Focus tabs | Project tabs show one group's workflow at a time on the same board. | Other groups are hidden; comparison takes switching. |

The playground supports editing names and note text, collapsing groups, adding columns and notes, moving columns between groups through their menu, light/dark themes, and resetting the examples. Edits are shared across the three views and stored locally. Area and column movement use their dotted drag handles; group navigation also works through the sidebar or tabs. Phone layouts retain fixed card text measurements and scroll inside the board.

The user selected **Canvas areas**, then requested planning arrows and mixed content inside areas. The preferred prototype now supports:

- Curved directional arrows between columns, supporting cards, or whole areas. Default arrows show the example workflows; the Project arrows form adds custom connections and lists removable arrows. The board toolbar hides or shows them.
- Arrows that follow moved/resized endpoints. Collapsing an area hides its internal arrows and retargets external connections to its boundary; switching to a focused tab hides arrows whose other endpoint is absent.
- Free notes, interactive checklists, editable web references, and uploaded local images inside an area. Use **Add to area**; drag the dotted handle to position an item, or use its area menu to move it to another group. Image uploads are limited to 1 MB for the local-storage demo.
- The whole area's columns and supporting items move and collapse together. Tidy aligns the workflow and arranges the supporting items below it. Area boundaries expand for their contents.
- Separate local persistence for sample connections and group content; older playground saves gain the new supporting items while retaining their existing columns, note edits and loose context text.

The production design should use an area as the project boundary and columns as workflow stages. This exploration leaves production decisions open: membership when dropping an item across a boundary, manual area resizing, note movement between columns, keyboard movement, undo, shared persistence/sync, culling, exports, and read-only sharing. The existing canvas, data model and board behavior remain unchanged in this branch.

Verification: `pnpm --filter web typecheck` and `pnpm --filter web exec playwright test --config concepts.playwright.config.ts`. The separate browser suite covers both Chromium and WebKit, including attached arrow geometry, creation/removal, collapse behavior, mixed item types, local image loading and persistence; it does not start the application's authenticated API fixture. Captures are in `apps/web/.impeccable/review/`.

The surface inherits `apps/web/DESIGN.md`: system typography, warm theme variables, Phosphor icons, flat cards, existing note text sizes and paired themes. No design tokens or durable system rules were changed. Impeccable reported an existing stale design sidecar; refreshing it is separate upkeep.


Production canvas areas are implemented separately; see [Canvas areas](../canvas-areas.md). The prototype notes and limits above describe only the development playground.
