# Multiplayer implementation and research

Status: implemented and locally verified. Deployment remains a separate release action: run the Release workflow manually on main after merge. Merging a pull request does not deploy.

## Product choices

The first release includes live note co-editing, board changes, people present, cursors, selections, gesture previews, follow, and a three-second location ping. Signed-in viewers participate without gaining write permission. Anonymous share links keep their existing behavior. The existing cosy visual system is authoritative.

Research: [Yjs collaborative editors](https://docs.yjs.dev/getting-started/a-collaborative-editor) and [CodeMirror 6 binding](https://github.com/yjs/y-codemirror.next) provide shared text and author-local undo. [Yjs awareness](https://docs.yjs.dev/getting-started/adding-awareness) separates temporary presence from durable work. [Figma follow/spotlight](https://help.figma.com/hc/en-us/articles/360040322673-Present-to-collaborators-using-spotlight) demonstrates the utility of following a collaborator; DoggyNote requires the follower to opt in and stops on manual navigation. [Cloudflare hibernating WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) fit the existing Worker and small-group deployment.

## Architecture and compatibility

Canonical Yjs state and Markdown projections are updated in one D1 transaction, guarded against note, object, and permission revision races. Normal sync carries read-only `noteState` sidecars and idempotent `noteUpdate` writes. Client objects and their outgoing updates use atomic IndexedDB transactions. Before closing an editor, pending native CodeMirror input is flushed into Y.Text. A compact per-tab session-storage journal protects the newest full CRDT state during reload when a browser cancels queued IndexedDB transactions; startup merges it with the cached state and restores the projection/outbox atomically before clearing the journal. Board metadata retains field-level last-writer semantics. Protocol 3 defines the sidecar format as Yjs binary update V1, base64 encoded. Explicit creation redo carries a consumed `noteRestore` intent; ordinary stale text updates cannot clear deleted/purged tombstones. Draft recovery runs before hidden or removed rows are discarded, including inactive drafts moved into a private Inbox. Note editors use a shared Y.Text; text is never replaced wholesale on remote arrival.

Each board has a hibernating Durable Object room. The authenticated ticket endpoint issues a one-use 30-second ticket; clients send it in their first WebSocket frame, never a URL. Rooms check sessions and current board access before broadcasting. Presence, cursors, selections, viewport positions, previews, and pings are ephemeral. Commit notifications contain no document data and prompt the existing authorized pull. Polling remains available when the room cannot connect.

Stage a compatible desktop updater before deploying migration 0012, Worker and web together. Sync protocol 3 and MIN_CLIENT 0.3.0 gate older clients. On upgrade, old pending whole-note replacements become recovery drafts rather than overwriting collaborative work. Do not roll back to a Worker that accepts protocol-2 note replacements after collaborative writes have begun: keep the write gate and state tables, or place editing in maintenance mode and restore a consistent backup. Never drop note state while retaining its Markdown projection and claim collaboration can resume safely.

## Roadmap

| Candidate | Value | Follow-up |
| --- | --- | --- |
| Mentions and unread comment markers | Bring someone back to a specific discussion | Design notification preferences and permissions first |
| Persistent card reactions | Lightweight agreement without a comment | Keep attribution and allow removing one's reaction |
| Board activity/history | Understand asynchronous changes and recover mistakes | Requires retention and restore semantics beyond transient presence |
| Cursor chat or playful emotes | Informal brainstorming | Evaluate demand after pings; avoid noise and motion overload |
| Presenter spotlight | Guided tours | Keep explicit participant consent and an always-visible exit |

## Operations and limits

Use structured Worker logs to count `collaboration_sync` by HTTP status and chart its `durationMs` p50/p95. 409 means an optimistic revision race and triggers a client retry; repeated 400/403 or 5xx needs investigation. `[live] notification_failed` and `[live] presence_failed` identify room delivery failures; HTTP polling continues during outages. Cloudflare request/DO WebSocket upgrade errors give connection failure rates. Logs added here contain only event names, status and elapsed milliseconds, never note text, board/user identifiers, tickets or credentials.

The browser emits `doggynote.live.connection-failure` Performance marks and `doggynote.live.convergence` measures (notification receipt through successful durable pull). A PerformanceObserver can export aggregate counts and p95 duration to an operator's monitoring system; the app does not send new analytics or identifying payloads. Only the latest mark/measure stays in the buffer. Run the two-authenticated-client synthetic typing/commit tests below as the end-to-end convergence probe: the local budget is one second. Alert on sustained elevated connection failures, note-sync errors, retry rates or convergence p95, rather than individual disconnects.

Messages and text have bounds: 100 selected/previews per session, 15 presence frames/second, pings at most once/second and three seconds visible, 256 KiB Markdown, and 2 MiB encoded canonical Yjs state. Yjs tombstones can grow with sustained edits; state-cap failures retain local work for recovery. Do not discard or reseed canonical CRDT history to compact it while offline clients exist. A future compaction protocol would need explicit epochs and recovery. Pings and previews never enter storage, undo or the outgoing durable queue.

## Verification record

227 unit/server tests passed; typecheck and the Worker dry build passed. The complete Playwright run passed 629 tests with seven expected skips across Chromium, WebKit, iPhone, Pixel and tablet projects. Native application builds were excluded; WebKit and the cross-origin desktop-flavour browser build cover their web behavior. Remote typing and committed movement met explicit one-second checks. Both existing large-board performance budgets passed, including ten authenticated participants. Rendered Impeccable assessments, the single correction/confirmation cycle, screenshots, detailed coverage and logs are in [QA evidence](qa/multiplayer/README.md).
