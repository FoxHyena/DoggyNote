# DoggyNote agent canvas project discovery

Status: Discovery and proposed implementation direction. Research date: 2026-10-25.

DoggyNote can become a visual workspace where people gather context, think with local agents, explore alternatives, and turn useful answers into project work. The central interaction is connecting existing cards to a chat card, iterating with Claude or Codex, and bringing the results back onto the board.

The first iteration should prove that complete loop with text context and desktop execution. The broader opportunity includes creative exploration, research, reusable project context, decision records, and project management. The implementation handoff is [the first iteration goal prompt](../goals/agent-canvas-iteration-01.md).

## User intent and audience

The requested direction is a node-based LLM workspace connected to local Claude and Codex harnesses. People should be able to drag connections from cards into chats to supply context, iterate on ideas, and manage creative or project work in the same place.

DoggyNote currently serves a small group of friends collecting and arranging ideas. Preserve that approachable, collaborative board experience. The new capability should help a person working alone or a small team moving from scattered references to a useful plan.

Primary jobs:

- Ask questions about selected project material without repeatedly copying it into external chats.
- Explore several directions from the same starting point and compare them later.
- Keep sources, conversations, decisions, and next actions connected and findable.
- Continue work through an existing local agent harness while understanding what it can access and change.

## Existing product foundations

The [repository README](../../README.md), [product context](../../apps/web/PRODUCT.md), and [project rules](../../CLAUDE.md) establish these foundations:

| Existing capability | Opportunity and constraint |
| --- | --- |
| Notes, tasks, images, links, files, columns, nested boards, and connectors | Reuse familiar cards and direct manipulation. Existing decorative connectors must not silently become executable context links. |
| SolidJS canvas, viewport culling, and low-detail rendering | Chat cards must stay light on large boards. An activated note-style chat contains the reading/composing view; passive and low-detail cards stay lightweight. |
| Offline editing, per-field synchronization, and collaborative Markdown notes | Preserve saved work and avoid replacing a whole conversation with stale state from another client. |
| Board grants, private Inboxes, and view-only shares | Apply access rules to transcripts, context snapshots, source labels, and generated outputs as well as cards. |
| Scoped MCP connector and reviewable agent proposals | Reuse proposal review for changes to existing work. The current connector is board-scoped, so it cannot by itself enforce connected-card-only reads. |
| Tauri desktop shell | Provides a place to own local agent processes. Browser-only execution needs a separate pairing design. |

The [current MCP setup](../mcp-setup.md) exposes board reads and proposed changes. It does not yet provide an in-app agent conversation or local harness lifecycle management.

The existing [card text helper](../../packages/core/src/cardtext.ts) is useful for labels and text extraction, but image captions and filenames are not the underlying image or document contents. A link preview is not a captured webpage.

## Comparable products

Documentation establishes the following features. The adaptation column describes proposed DoggyNote choices.

| Reference | Relevant documented behavior | DoggyNote adaptation |
| --- | --- | --- |
| [Slashspace branching](https://www.slashspace.ai/docs/canvas/branching) and [local providers](https://www.slashspace.ai/docs/settings/subscription-providers) | Branch chats, branch from passages, and drive local Claude Code or Codex CLIs. | Use chat cards, explicit sources, and branching as the core interaction reference. |
| [Poppy context](https://intercom.help/poppy-ai/en/articles/13171184-how-poppy-handles-context) | Connected references and conversation history supply context to a particular chat. Its documentation describes full connected context rather than retrieval-based selection. | Reuse sources across focused conversations and make inclusion visible. Bound inputs rather than promising unlimited context. |
| [nodeterm Context Link](https://www.nodeterm.dev/docs/agents/context-link) | Linked local agents can pull transcripts, summaries, or recent output. Notes can feed agent sessions. | Later support focused handoffs between agents and on-demand access to linked material. |
| [Heptabase AI](https://wiki.heptabase.com/fundamental-elements) | Chat with selected knowledge, receive source citations, run reusable actions, and save responses as cards. | Complete the cycle from existing knowledge to conversation to editable board content. |
| [FLORA canvas](https://docs.flora.ai/editor/canvas) and [Weavy nodes](https://help.weavy.ai/en/articles/12292386-understanding-nodes) | Connected text and media generation, reference inputs, model parameters, and explicit generation actions. | Preserve references and alternatives beside their outputs; add richer media after the text loop works. |
| [OpenCove](https://github.com/DeadWaveWave/opencove) | Local agent sessions, terminals, notes, tasks, persistent workspaces, and snapshots on a canvas. Its README describes the product as alpha. | Preserve project working state and make agent progress visible. |
| [Flowise Agentflow](https://docs.flowiseai.com/using-flowise/agentflowv2) and [Langflow Playground](https://docs.langflow.org/concepts-playground) | Executable workflows, branching, tool inspection, and human review checkpoints. | Borrow clear execution states and review controls as automation grows. |

Study Slashspace, Poppy, Heptabase, and nodeterm first. Together they cover the closest interaction, context reuse, saving results, and local harness integration patterns.

## User evidence and product implications

These firsthand accounts are qualitative signals, not a representative survey or a ranking of feature popularity.

| Evidence | Reported value or friction | Product implication |
| --- | --- | --- |
| [Verified Poppy purchaser](https://appsumo.com/products/poppy-ai/reviews/a-strong-tool-for-visual-non-linear-ai-386382/) | Valued original references remaining on a board, mixing context across chats, and source-specific instructions. Reported confusing credit use and mobile limitations. | Support reusable sources, focused instructions, visible context size, and usable touch alternatives. |
| [Art director testing FLORA](https://www.tribera.com/news/creative/testing-flora-ai-5-lessons-for-creative-teams) | Valued comparing directions and seeing the references, iterations, and discarded ideas behind a result. More generated options still required judgment. | Preserve the exploration trail and make selection and synthesis easy. |
| [Heptabase integration discussion](https://www.reddit.com/r/heptabase/comments/1wov5ar/heptabase_chatgpt_plugin_is_now_available_bring/) | Users described frequent use for moving useful information between AI and their knowledge workspace; simpler setup helped adoption. | Make connection setup understandable and saving results a first-class action. |
| [Heptabase AI feedback](https://www.reddit.com/r/heptabase/comments/1vjv53c/the_problems_ive_been_experiencing_with_heptabase/) | A user reported unpredictable iteration, unclear credit consumption, and slow large boards. | Provide Stop, visible activity, honest usage information, and maintain canvas performance. |

The product hypothesis is that choosing, reusing, inspecting, and preserving context will deliver more lasting value than generation volume alone.

## Proposed experience

### Connect and inspect context

Create a Chat card, select an available local provider, and connect source cards to it. A directional context link means that a source is available to this conversation. Ordinary connectors retain their existing visual meaning.

Offer drag connections, Ask about selection, and an Add context picker. Add mentions as a later convenience if the picker already solves keyboard and touch use. Show clickable source chips and a context inspector with included content, exclusions, and an approximate size. Never silently trim or imply that unsupported files were read.

Start with direct source links. Do not recursively traverse the board, infer access from proximity, or run a chat when someone draws a line. Sending a message is the explicit execution action.

### Iterate and branch

**UI direction confirmed 2026-10-25:** keep one conversation inside a note-style object on the board. Read messages and compose follow-ups in that object alongside its connected sources. Provider, context inspection, and message actions remain secondary controls. An optional focus reader can support long threads later; a separate chat dialog is no longer the default. See the [UI direction and comparison notes](../qa/agent-canvas/ui-direction.md).

Branch from a completed message to explore another direction while preserving the parent. Record the parent message and inherited context. Cross-provider branches carry the chosen visible transcript and context into a new session; they do not transfer hidden reasoning or native session state.

### Save results

Save an answer or selected passage as an ordinary editable note with provenance back to its conversation. Create a proposed to-do list from a selected answer. Updates to existing work use the established proposal review and conflict handling.

Saving a result must be explicit and undoable. Repeated delivery or retries must not produce duplicate notes or task proposals.

### Understand execution

Show idle, preparing context, running, waiting for approval when applicable, completed, interrupted, and failed states. Stop should cancel actual work and preserve any partial answer as incomplete. A transport disconnect must not appear as success.

Bind each active run to the initiating user and device. Collaborators can view authorized shared conversation content, but synchronizing or viewing a card must never start a process on someone else's computer.

## Proposed first iteration

Prove this path in the Mac app:

1. Create notes and a to-do list on a board.
2. Connect selected cards to a Chat card and inspect what will be sent.
3. Send a prompt through a locally installed Claude or Codex harness and read the streamed answer.
4. Ask a follow-up, stop a run, and recover from an error without losing the conversation.
5. Branch from a completed answer into a separate conversation.
6. Save an answer as a note and generate a reviewable task-list proposal.
7. Reload, reconnect, and continue without duplicate messages or lost results.

Required initial scope is text from note cards and to-do lists, both provider adapters, direct context links, branching, saving results, and useful unavailable-provider states. Browsers and phones can view authorized saved chats and use supported board operations; local execution is desktop-only initially. Run controls explain that a desktop connection is required.

Defer full webpage capture, PDF extraction, image understanding and generation, transcription, automatic workflow execution, recursive context graphs, agent orchestration, remote pairing, project filesystem tools, and scheduled runs. Unsupported source types must have a clear explanation. This keeps the first loop testable without expanding into a general automation platform.

## Context and persistence contracts

- Resolve source permissions at send time. Each turn records the actual source versions and content supplied, subject to board access rules. Deduplicate sources and enforce explicit input limits.
- Editing a source affects future sends. Prior answers retain their original provenance and can show that sources have changed. Do not silently rerun them.
- Removing a context link stops future inclusion but cannot retract content already present in the provider's conversation history. Offer a clean conversation for exclusion, and explain this at the relevant action.
- Treat source material as untrusted data. Source-specific user instructions are separate from captured source text. Do not let embedded text grant tools or wider access.
- Connected-card-only behavior must constrain tools as well as the initial prompt. Disable broad board reads for that mode or implement narrower capabilities. Initial brainstorming can run with filesystem and shell tools disabled.
- Store shared messages and context records under the board's access boundary. Keep provider credentials, device-local session bindings, local paths, and raw sensitive tool diagnostics out of synchronized card content.
- Serialize writes to a conversation and define retry identity. Closing an expanded view or culling an off-screen card must not destroy its run or transcript. Interrupted work remains resumable or restartable as supported.
- Public shares and export need an explicit representation. The first iteration should show a neutral chat placeholder rather than publish raw transcripts or context snapshots; ordinary notes deliberately saved from answers follow normal board sharing. Enforce redaction server-side for public responses, not just visually.
- Revoking access prevents future reads and runs. Previously disclosed information follows the product's existing recovery and retention rules; do not claim it can be remotely forgotten.

## Harness integration

The desktop app should own a small provider abstraction for discovery, session creation, sending, streaming, interruption, continuation, and cleanup. Use native forking when compatible with the requested branch point; otherwise create a new session with explicit visible history.

[Codex app-server](https://developers.openai.com/codex/app-server) exposes threads, turns, events, approval requests, resume, and forks. Start with a local stdio transport, check protocol capabilities, and record tested CLI versions. Review experimental surfaces before relying on them.

The [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) exposes the Claude Code agent loop, sessions, permissions, and hooks. A subprocess integration is also documented. Choose the smallest supported route compatible with Tauri and the installed harness, after a real integration spike.

Claude authentication needs rechecking before implementation: the [subscription help article](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) permits third-party subscription usage, while the SDK overview retains restrictions on offering third-party login without approval. Validate the intended local integration rather than promising billing behavior from another product's documentation.

Local harness execution normally still calls hosted models. Provider limits apply; show usage only when reported and label estimates. The Worker stores authorized project data and must not become a remote command launcher.

## Further product opportunities

| Priority | Opportunity | Value and scope |
| --- | --- | --- |
| Next | Source-specific instructions and selected passages | Direct a source's role, such as tone reference, requirements, or a claim to critique. |
| Next | Reusable context collections | Reuse a brief, audience, constraints, style references, and accepted decisions across chats; preview membership. |
| Next | Decision cards | Preserve the chosen direction, rationale, alternatives, and evidence so future conversations build on accepted decisions. |
| Next | Compare and synthesize | Run the same context through two providers, compare answers, and deliberately combine selected parts. |
| Later | Research to brief to tasks | Produce reviewable artifacts and task dependencies while keeping source links intact. |
| Later | Creative iteration templates | Seed campaign exploration, story development, product discovery, project kickoff, and critique boards. |
| Later | Agent handoff cards | Summarize the objective, decisions, unresolved questions, and next actions for another person or agent. |
| Later | Project folders and richer media | Add explicit local directory grants and document/media processing with clear capability and privacy boundaries. |
| Later | Reusable executable workflows | Add bounded sequences, review checkpoints, and explicit rerun controls after manual iteration proves useful. |

## Validation and open decisions

Run one real project kickoff and one creative exploration with the first iteration. Record manual copy/paste steps, context reuse, useful branches, saved outputs, failure recovery, and whether users can explain what the agent saw. These are proposed evaluation measures; no baseline or target improvement has been measured yet.

The first milestone is useful only if users can complete both scenarios, reuse a source across two chats, preserve alternatives, save editable results, and recover their work after reload. Automated checks establish behavior; observed use establishes whether the workflow helps.

Before broad implementation, resolve the exact local provider transport/authentication routes, transcript append and conflict semantics, and storage limits for context snapshots. The first iteration defaults above settle desktop execution, direct links, text-only inputs, and public-share redaction. Record deviations and their evidence rather than silently broadening the scope.

Questions for subsequent product validation include whether summaries or full history make better handoffs, which creative source formats matter first, and whether decision cards or reusable context collections produce the most repeated use.
