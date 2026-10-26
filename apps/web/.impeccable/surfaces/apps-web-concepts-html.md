---
version: 1
slug: "apps-web-concepts-html"
primary_target: "apps/web/concepts.html"
related_targets: ["apps/web/src/concepts/GroupingPlayground.tsx","apps/web/src/concepts/grouping.css","apps/web/src/concepts/areaModel.ts"]
---

# Column grouping exploration

Mode: Operate. A local, synthetic board playground lets the user compare three extensions of the existing board: spatial areas, aligned sections, and focused group tabs. The user prefers Canvas areas, with arrows for project planning and independently positioned notes and other items inside an area. No choice is committed to the production model. The user wants both project/area grouping and workflow stages. Each illustrative project has Ideas, Planning, and Ready columns.

## Direction contract

THESIS: Make relationships between columns legible while preserving readable notes. Compare spatial grouping, automatic alignment, and focused navigation through working examples.

OWN-WORLD: Inherit DoggyNote's system font, warm theme tokens, Phosphor controls, dotted canvas, small firm headings, flat cards and matched light/dark themes.

STORY: Switch between three concepts with the same sample content; rename groups, edit notes, move columns and free items, collapse groups, add content and reset the demo. Areas contain notes, checklists, links and local image references; arrows connect columns, supporting items or whole areas and stay attached during movement. Only this playground stores its state.

FIRST VIEWPORT: Compact concept selector above the familiar board chrome. The canvas fills the main work area; a narrow right panel explains the selected concept and its tradeoff. The grouping mechanism is visible immediately. At phone widths the explanation follows the board, and the board retains readable card sizes inside a scrollable viewport.

FORM: Local feature extension; no concept-seed required. Signature interaction: drag an area's dotted handle and its columns, free items and arrow endpoints travel together; sections align their contents; tabs isolate a group without entering a nested board. No entrance animation; reduced motion remains immediate.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
