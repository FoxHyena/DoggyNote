# Canvas areas

Areas group a project on the existing board. Columns inside an area still represent workflow stages. Notes, images, files, board tiles, colour cards, links, movies, sketches, stickers and board ink can be arranged alongside them. This feature does not import playground sample data.

## Working with an area

- Choose **Area** beside **Column**, or select items and choose **Create area from selection**. A selected column brings its cards. Select a column itself, or take a member out, before wrapping it in an area.
- Drop an item into the highlighted boundary to join. Drag outside to leave. An eligible column takes precedence when dropping a card.
- Drag the header to move the family. Resize the boundary to set its minimum dimensions; members retain their sizes and relative arrangement. The frame expands around members, including rotated stickers. Titles and header actions stay attached to their area on every device, moving and scaling with the canvas. Pan to reach header controls outside the viewport.
- **Add to area** uses the existing card editors, file/image import, sticker collection and drawing tool. Production uploads retain the existing production limits.
- **Tidy** aligns columns left to right and places supporting cards below. Stickers and board ink remain where placed. Ordinary editing never tidies automatically.
- Use **Line** or the existing connection handles for manual arrows. Collapse hides members and internal arrows; external arrows project onto the collapsed frame. Search reveals both the area and a containing column.
- **Remove area, keep contents** preserves world positions, including retained buried members. **Bury area and contents** is separate. Undo restores the operation. Bulk restoration restores only descendants carrying that operation’s burial ID, even if another burial has the same timestamp.

View-only disclosure changes stay local. Editors sync collapse state. Position locks on an area protect its family layout; a locked member pins whole-area movement, removal and Tidy while other unlocked members can still move individually.

## Persistence and geometry

An area is a `Card<'area'>` with a title, colour, collapse state and manually requested `w`/`h`. Direct card and sticker members store `areaId`, with `x`/`y` relative to the stable area origin. Column children use only `columnId` and inherit their column’s area. Comments and strokes retain their existing owning-card references. Nested areas and conflicting parents are invalid.

`packages/core/src/areas.ts` owns family traversal, origin conversion, minimum-frame expansion, collapsed endpoints, explicit Tidy and sync dependency ordering. `apps/web/src/canvas/layout.ts` resolves measured world geometry and temporarily freezes a source boundary during a member drag. Measured frame size never becomes a stored minimum through ResizeObserver.

Area backgrounds share the existing camera transform and render behind independently culled members. The existing low-detail renderer handles overview zoom. Clipboard copies remap area, column, stroke and connection IDs; a member copied alone is flattened to its world position. PNG export includes visible area contents and in-scope arrows.

The existing IndexedDB stores and field-patch endpoint remain in use. Parents precede references across 200-object chunks; detaches precede final area removal. The server guards the final removal against concurrent joins, and the client refreshes, detaches newly arrived members and retries. The reload journal preserves a complete queued operation when a quick reload interrupts IndexedDB saving, while retaining legacy queued edits for their existing recovery path. A parent lock racing a creation preserves the new item at its world position. Large cross-board transfers first detach source references in 200-object chunks while keeping the final destination membership and local coordinates durably queued; a restart resumes the transfer. Inbox lists show the area as one family.

Agent proposals use the same parent, permission and layout rules. Area dimensions are intentional geometry rather than ignorable card-height measurements.

## Compatibility and release

Sync protocol is **4**, the coordinated minimum client is **0.4.0**, and `version.json` selects minor **4**. Existing objects without `areaId` retain their original coordinates. No new database table or bulk migration is required.

Release through `.github/workflows/release.yml` after merge to `main`, as required by `CLAUDE.md`. That workflow reruns CI, stages the compatible signed/notarized Mac update, deploys Worker and web, then publishes the updater manifest. Do not deploy the protocol gate ahead of that compatible desktop artifact.

The exploratory concepts remain under `apps/web/src/concepts`; their standalone documentation describes the playground only. Production behavior is described here.
