# DoggyNote agent canvas first iteration goal prompt

Build the first complete connected-context conversation loop from [the project discovery](../discovery/agent-canvas.md). This is a handoff for another agent in this repository. Creating this document does not start a goal or delegate implementation.

## Start the goal

Paste the following into the implementing agent's conversation with this repository open. On a Codex build supporting Goals, `/goal` is a conversation command, not a shell command; see [official Goals documentation](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex). In another harness, omit the `/goal` prefix and use the same objective and work loop as an ordinary implementation prompt.

```text
/goal Implement the first DoggyNote agent canvas iteration specified in docs/goals/agent-canvas-iteration-01.md, using docs/discovery/agent-canvas.md as product context. Deliver a working Mac desktop loop: connect note and to-do cards to a chat card, inspect the exact context, converse through local Claude and Codex harness adapters, branch from a completed answer, save an answer as an editable note, and create a reviewable task-list proposal. Continue through implementation, meaningful tests, engineering review, real interaction and visual review, and fixes until all required acceptance criteria have evidence. Preserve DoggyNote's access controls, offline editing, sync, undo, themes, touch behavior, and large-board performance. Record decisions, findings, exact checks, live-provider results, and remaining gaps in docs/qa/agent-canvas/README.md. Choose the next iteration from the highest-impact failing criterion. Complete independent work around missing credentials or tools, report exactly what unlocks remaining verification, and follow the runtime's blocker rules without marking incomplete work done. Leave a reviewable local diff. Production deployment, publishing, paid setup, and broader roadmap features are outside this goal.
```

## Objective and boundaries

A person should complete a small project kickoff or creative exploration in DoggyNote: attach reusable text context, ask and follow up, pursue an alternative, preserve a useful answer, and turn it into actionable work.

Implement both local provider adapters. Build and prove one real end-to-end provider path first, then bring the second to the same contract. If one cannot be verified live, retain that criterion as incomplete and finish all independent implementation and deterministic verification.

Initial context sources are Markdown notes and to-do lists on the current board. Local execution belongs to the Mac desktop client. Browsers and phones can read authorized saved conversations and use applicable board operations, but do not get remote execution or pairing in this iteration. Provide useful desktop-required and unavailable-provider states.

Do not expand this goal to PDF parsing, full webpage capture, image or video understanding/generation, transcription, recursive graphs, automatic reruns, multi-agent orchestration, filesystem editing tools, scheduled work, reusable workflow builders, or remote-device pairing. Keep those in the discovery backlog.

## Read before implementation

Read applicable `AGENTS.md` files, `CLAUDE.md`, the discovery document, `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`, and `docs/mcp-setup.md`. Inspect the current code instead of assuming filenames or interfaces are unchanged.

Trace the card and connection model, patches and undo, text extraction, sync and access validation, proposal handling, persistence, canvas selection and input, card rendering and LOD, public viewer and export, and the Tauri command/capability boundary. Useful entry points include:

- `packages/core/src/model.ts`, `cardtext.ts`, `agent.ts`, and `patch.ts`.
- `apps/web/src/canvas/`, `state/doc.ts`, `state/sync.ts`, `state/platform.ts`, and the proposal UI.
- `apps/server/src/`, especially board access, synchronization, agent endpoints, and public share responses.
- `apps/desktop/src-tauri/src/lib.rs`, desktop capabilities/configuration, and `apps/mcp/src/index.ts`.

Recheck official provider documentation and installed CLI capabilities before selecting transports or authentication. Preserve existing user authentication; do not extract, copy, log, or sync provider secrets. Resolve the Claude documentation discrepancy described in discovery. Do not invent a subscription entitlement or bypass authentication restrictions.

Use relevant available skills. Record this multi-step implementation on the Paseo progress dashboard if its skill/CLI is available, continuing a matching open run without replacing another job. Work in this checkout, preserve unrelated edits, and perform engineering and UX self-reviews in distinct passes. Delegated agents are not required.

## Required behavior

### Context and chat

Add a compact Chat card and an expanded conversation view. Provide drag-to-connect plus an Add context picker and Ask about selection. Keyboard and touch users must be able to choose sources without dragging. Ordinary visual connectors retain their current meaning.

Each send gathers direct linked sources only, deduplicates them, rechecks access, and creates a stable context record with source identity, version, and supplied text. The inspector shows what will be supplied, exclusions, and an approximate size. Set documented bounds and show a recoverable oversized-input error rather than silent truncation. Unsupported source types explain the limitation.

Editing a source changes the next send. Previous turns retain their context record and can indicate changed sources. Removing a link affects future inclusion; explain that earlier provider history can retain the content and offer a clean conversation. Source text is data and cannot grant tools or wider access.

Make connected-card-only scope real: do not give the chat the current board-wide MCP read capability while describing access as restricted to linked cards. Initial brainstorming should use no shell or project filesystem tools. Reuse the existing proposal pipeline through a narrow application operation for generated task proposals.

### Local provider lifecycle

Discover configured local providers and show readiness or an actionable missing/unsupported/signed-out state. Keep executable selection controlled by local configuration, never arbitrary synced card content. Spawn with argument arrays, not interpolated shell commands. Define and document the supported CLI versions and capabilities.

Implement session creation, send/follow-up, streamed output, Stop, completion/error handling, continuation where supported, and cleanup. Correlate events to the correct user, device, conversation, and run. Handle malformed/late/duplicate events and process exit without corrupting another run.

Use actual provider-reported activity and usage where available. Estimates must be labeled. If permissions or input requests can occur, expose a recoverable waiting state and scoped response; do not auto-approve broad tools or leave a hidden request hanging.

Opening or syncing a chat must never launch work. A collaborator cannot start a local process on the initiating person's computer. Closing the chat view or culling its canvas card must not cancel a run. Quitting the app should leave a truthful interrupted state and recoverable transcript, not an apparent completed run.

### Branch and save

Branch from a chosen completed assistant message, preserving the parent thread and the context through that point. Future parent messages must not leak into the branch. Record the parent message. Use native fork only if it faithfully implements this boundary; otherwise start a new session from explicit visible history. Cross-provider branching uses visible history and context, with no claim to transfer hidden state.

Save an answer or selected text as an ordinary editable note with provenance. Generate a to-do-list proposal from a selected answer and let the user inspect and approve or reject it through existing proposal UI. Generated task lists should start with unchecked tasks and no invented owners or deadlines. Keep proposal conflicts and reversals consistent with existing behavior.

Use stable operation IDs so retries cannot create duplicate messages, notes, or proposals. Saved notes and context-link changes follow normal undo/redo. Undo must not claim to reverse a provider request already sent.

### Persistence and sharing

Persist conversation content and context records under board authorization with explicit append/conflict semantics. Prevent concurrent sends from interleaving into one session. Keep local session bindings and sensitive process diagnostics separate from shared board data. Define retry, reconnect, and app-restart behavior.

Preserve private Inbox and inherited access behavior on every new endpoint. Recheck permission before a new turn and stop access on revocation. Existing disclosure cannot be undone by removing a link or grant.

Public shares and PNG export show a neutral chat placeholder in this iteration. Raw transcripts and context snapshots must be omitted from public server payloads, not merely hidden in the viewer. Ordinary output notes deliberately saved to the board follow existing sharing rules. Preserve safe unknown-card behavior and old desktop compatibility; document any minimum-client/protocol gate needed without releasing it.

## Work loop

Create `docs/qa/agent-canvas/README.md` when implementation starts. Track each acceptance criterion as pending, working, passed, or blocked, with evidence. Include architecture decisions, a findings table with severity/reproduction/fix/check, exact command results, provider versions, live versus fixture verification, and curated screenshots or recordings. Record a single next action for continuation.

Repeat the following until the acceptance matrix passes:

1. **Choose the next gap.** Read the current checklist and diff. Prioritize context/access correctness, saved-work integrity, and a working provider path before optional polish. State what the next slice will prove.
2. **Implement a narrow complete slice.** Begin with source selection through one real streamed answer and persisted reload. Add the second adapter, branching, result saving, task proposals, recovery, and compatible views incrementally. Make ordinary engineering choices and document them; seek clarification only for consequential unresolved product choices or genuinely missing access.
3. **Verify the behavior.** Add meaningful pure logic, server boundary, provider contract, and browser interaction coverage as appropriate. Use deterministic fake processes/transports for CI. Test events, cancellation, persistence, retries, and failures rather than only final rendering. Keep test adapters inaccessible as production providers.
4. **Review as a maintainer.** Trace permission enforcement, context isolation, transcript concurrency, process lifecycle, idempotency, bounded inputs, public redaction, backwards compatibility, undo, and performance. Record and fix findings.
5. **Review as a user.** Walk through populated boards with ordinary mouse, keyboard, and touch controls. Inspect source selection, context inspection, expanded chat, streaming, Stop, branching, saving, approval, and errors in both themes. Check desktop and narrow windows, phone safe areas and keyboard behavior, focus restoration, and reduced motion. Inspect the native Mac path as well as browser fixtures.
6. **Fix and reassess.** Rerun affected checks and revisit the highest-impact remaining criterion. Perform another visual inspection after visual fixes. Run integrated checks on the finished change; do not repeatedly run the full suite without a change or unresolved concern that justifies it.

Keep progress updates concise and report findings, decisions, and what the next check resolves. Do not stop at a plan or a simulated chat when independent implementation work remains.

## Acceptance matrix

| ID | Required outcome | Evidence |
| --- | --- | --- |
| A01 | Create a chat, attach two notes and a to-do list, inspect exact source text, and send without manual copying. Unlinked cards remain excluded. | Real-input Chromium/WebKit tests and a native walkthrough. |
| A02 | Both Claude and Codex adapters support a real answer and follow-up. Missing CLI, signed-out, unsupported version, rate limit, and failed process states are recoverable. | Deterministic provider contract tests plus a live smoke check for each provider with CLI version and auth route recorded. |
| A03 | Stop interrupts actual work; partial output is labeled. Closing/culling a card preserves the run. Late events cannot revive or duplicate a completed/cancelled run. | Fake-process event tests and native cancellation/view-lifecycle checks. |
| A04 | Edit/disconnect sources, inspect the next send, recognize changed context, and start a clean conversation. Unsupported/oversized context is never silently represented as fully read. | Context assembly tests, payload assertions, and interaction walkthrough. |
| A05 | Branch from a chosen answer into an independent chat with correct history and context. Later parent turns stay excluded. | Persisted branch assertions and a live same-provider or visible-history branch; cross-provider contract coverage. |
| A06 | Save selected answer text as an editable note; create, inspect, approve/reject a task-list proposal; retries do not duplicate results. | Browser tests against the real local Worker, undo/redo and proposal conflict checks. |
| A07 | Reload, reconnect, app restart, concurrent clients, and repeated send events preserve conversation integrity. | Persistence/sync tests plus native restart walkthrough. |
| A08 | Access revocation, private Inboxes, view-only grants, and public shares enforce the intended boundaries. Public payloads omit transcripts/snapshots and never start local work. | Server authorization/redaction tests, multi-user browser cases, and runtime ownership tests. |
| A09 | Expanded and compact views work with keyboard, desktop pointer, and touch in both themes. Browser/phone execution limitations are understandable. | Chromium/WebKit desktop, iPhone/Pixel touch coverage, inspected screenshots, and native desktop review. |
| A10 | Large boards retain culling/LOD, export remains usable, and streaming does not cause broad per-token board rerenders or sync writes. | Existing performance checks plus a representative chat-heavy/streaming fixture, before/after observations, and export checks. |
| A11 | Required repository checks pass with no unresolved critical/high correctness findings or task-blocking UX defects. | Exact commands, results, and final diff review linked in the QA record. |

## Verification commands and completion

Confirm current scripts before running. The repository's expected integrated checks are:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
git diff --check
```

Run focused Playwright tests first and preserve the repository's WebKit/Chromium and touch expectations. Follow its backend isolation conventions and use `E2E_PORT_OFFSET` when needed. Run existing performance coverage and suitable desktop Rust checks for changed native code. A production build alone is not evidence that live provider streaming, cancellation, and restart work inside Tauri.

For live smoke checks, use the smallest task needed to prove context, a follow-up, and branching/cancellation, within the user's configured limits. Do not purchase services, install account-wide tools, change billing, or deploy to obtain a passing check. If live provider credentials or native access are unavailable, complete deterministic coverage and independent implementation, then identify the exact missing prerequisite. Do not log secrets or substitute mocked results for live evidence.

Record pre-existing failures separately and investigate their relevance. Do not weaken assertions, loosen performance budgets, or mark tests passed because they were skipped. Missing required live/native checks remain incomplete. Follow the active runtime's rules for when a persistent external blocker changes goal status; elapsed time is not approval, and a blocked check is not completion.

The final handoff must link the implementation and QA record, describe the resulting user flow and material decisions, list checks actually run, show final visual evidence, and identify every remaining acceptance gap. Leave a reviewable local diff. Stop adding features once this iteration's required outcomes are verified; backlog ideas remain in discovery.
