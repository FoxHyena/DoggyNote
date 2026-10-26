# Conversation on the board

Confirmed 2026-10-25: one note-style object contains the thread. Operate surface within DoggyNote's existing Warm Den design system. Current verification is web-only.

## Direction contract

**THESIS:** A conversation is working material on the board. Read, follow up, inspect context and preserve an answer without leaving its sources.

**OWN-WORLD:** Existing note surfaces, swatches, 6px card corners, system type and quiet controls. The title belongs to the paper; provider and source controls are secondary. Both themes remain equal.

**STORY:** Connect notes, inspect sources, ask inline, follow up, then branch or preserve a useful answer beside the thread.

**FIRST VIEWPORT:** A readable note-width thread next to its source cards. Title above provider/source controls, flat question/answer typography, composer at the foot. Context inspection temporarily uses the card body. No backdrop. Header remains draggable, body selectable and scrollable.

**FORM:** User-selected single conversation card. No visual-world roll: the requested local form and incumbent identity are settled. Fixed board geometry isolates streamed text from layout/sync; inactive cards show the last cached exchange. Full history loads only after deliberate activation.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Research and future fit

- [Slashspace chat nodes](https://www.slashspace.ai/docs/nodes/chat-node): on-canvas conversation/composer; optional collapse and side view. Adapt the board-first interaction, retaining DoggyNote's explicit-send and no-tools boundaries.
- [Slashspace branching](https://www.slashspace.ai/docs/canvas/branching): alternatives sit alongside their parent. DoggyNote keeps a fixed branch boundary; Slashspace's live parent context is a different contract.
- [Poppy context](https://intercom.help/poppy-ai/en/articles/13171184-how-poppy-handles-context): connected references and conversation history define the chat's input. Keep inclusion inspectable and bounded.
- [Heptabase](https://wiki.heptabase.com/fundamental-elements): useful answers become editable board cards. Keep explicit note/task output operations close to the answer.
- [nodeterm Context Link](https://www.nodeterm.dev/docs/agents/context-link): linked agents can pull transcripts/summaries. This informs later handoffs, not automatic execution in this iteration.

The discovery's decision cards, reusable context collections, compare/synthesize and handoffs can occupy neighboring board objects. This pass adds none of those capabilities. A future optional focus reader can help with long threads without becoming the default interaction.
