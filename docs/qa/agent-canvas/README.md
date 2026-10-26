# Agent canvas iteration 01 — implementation and QA

Started 2026-10-25. The implementation is partial; the original goal remains incomplete. Browser-only verification is the current user-requested focus (2026-10-25: “Just test in web for now it's okay”). Native walkthroughs are deferred, not counted as passed.

## Current slice and next action

Current slice: **conversation inside one note-style board card**, confirmed by the user after the initial dialog implementation. Read the [UI direction and comparison notes](ui-direction.md). The discovery now records that override. Provider execution remains desktop-only; current verification stays in web browsers.

The note contains the thread, inline composer and source controls. Context inspection uses its body, leaving the surrounding board available. Branches are placed beside their parent with a decorative provenance link. Passive cards restore a local saved exchange without fetching entire transcripts; only an explicitly activated card mounts the live thread. Fixed card geometry keeps token updates out of layout/sync. Prompt and provider-question drafts survive close/culling and reload in local storage scoped to the signed-in owner and conversation/request; successful logout clears that owner’s drafts.

The requested code, UX and design review fixes are implemented, and all three independent reviewers scored their original findings resolved. The conversation matrix passed **30/30** before the narrow send-conflict correction, and the final corrected-source account/desktop/conversation matrix passes **54/54**, both with four workers and retries disabled. The complete web run on the first review-fix bundle finished **1,059 passed / 1 flaky / 8 skipped (12.3m)**, with no persistent failures. It exposed an initial-send transaction conflict, whose bounded retry correction is documented below. Corrected-source focused results are recorded separately. Both native adapters exist; native GUI and live-provider parity checks remain deferred under the user’s web-only steering. Browser bridge and synthetic endpoint results are fixture evidence only. The original native Chrome visibility fixture is unchanged and its predicate also reproduces on blank pages.

## Acceptance evidence

| ID | Status | Evidence still required |
| --- | --- | --- |
| A01 | working | Chromium/WebKit real-input tests attach two notes and a list and inspect exact text; drag, ordinary-line separation and undo/redo pass both engines. Native walkthrough deferred. |
| A02 | working | Both Rust adapters exist. Claude has one real CLI answer with zero tools/MCP; Codex has production-driver streaming/isolation evidence against a synthetic endpoint. Live follow-up/branch and all live Codex behavior remain unverified. Browser bridge is fixture evidence only. |
| A03 | working | Browser bridge verifies Stop, partial labeling, view closure, reload and late events; SQLite tests verify monotonic updates, ownership, expiry and terminal sealing. Actual child-process tests also interrupt streaming and pending input without revival. Native GUI view/cancellation walkthrough deferred. |
| A04 | working | Pure/SQLite tests verify bounds, unsupported sources, exact snapshots and edit/disconnect semantics. Browser recovery tests now exercise source edits, removal and oversize errors. |
| A05 | working | Exact branch boundary and independent persisted history pass SQLite/pure tests; browser branch flow passes both engines. Live same-provider branch still missing. |
| A06 | working | Both browser engines verify editable answer notes, duplicate-save identity, undo/redo, branch and task proposal approval. Real SQLite tests also cover proposal rejection, conflict and reversal. Full regression and the inline redesign checks are recorded below. |
| A07 | working | Server append/retry/concurrency/lease tests pass; browser fixtures cover reload, offline final-save recovery and completion racing an IPC answer reply. Pending-question reload and completion now pass deterministic transaction-conflict injection, durable-counter checks and late-IPC cleanup assertions. Native restart/reconnect deferred. |
| A08 | working | SQLite tests cover private Inbox, view grants, racing revocation, ownership and public redaction. Browser anonymous viewer/export checks added; the real Worker multi-user view/revocation browser case passes both engines. |
| A09 | working | Dark/light screenshots captured for Chromium/WebKit and iPhone/Pixel. Touch picker and simulated keyboard checks pass. The inline redesign has a scoped independent ship verdict. Passive cards now restore a cached exchange/status; a fresh device deliberately loads history on activation. Native review deferred. |
| A10 | working | The original dialog produced zero canvas mutations. With the on-board thread, 80 streamed fixture updates now mutate only that chat note, with **zero mutations outside chats and zero board sync writes** in both engines. Card mounts fetch no transcripts. Neutral export covered; the headed GPU budget and a 1,000-chat structural fixture both pass; results below. |
| A11 | working | Workspace typecheck and **38 unit files / 329 tests** pass after review fixes. Final conversation matrix **30/30**, broader account/desktop matrix **54/54**, four workers and retries disabled. Complete regression: **1,059 passed / 1 flaky / 8 skipped (12.3m)** before the narrow send-conflict correction; corrected-source focused results below. Prior full-run limits remain recorded. All three original reviews are resolved at their finding scope. Root DMG packaging and native/live walkthroughs remain open; local `.app` build evidence is recorded below. |

## Decisions

- Conversation bodies and immutable per-turn context belong to dedicated API storage, separate from ordinary last-writer-wins card fields. Chat cards remain small canvas objects. Opening/syncing them cannot execute a provider.
- Only a directional connection with `purpose: context` supplies sources. Existing visual lines retain their meaning. Sources are direct notes/to-dos on the current board, deduplicated, access-filtered server-side and captured again before every send.
- Limits: 24 source cards, 60,000 source characters, 12,000 prompt characters, 60,000 answer characters, 160,000 serialized provider-input characters and 100 turns. Oversize errors are recoverable; no silent truncation. Token sizes are explicitly estimates (characters / 4).
- Provider input uses explicit visible history and captured context. Branches copy only through the chosen completed answer; no claim of hidden-state transfer.
- Run execution must be user-initiated on the local Mac. No board MCP, shell, filesystem, or broad approval capability is supplied to a brainstorming session. Device/run credentials and raw diagnostics remain local.
- API changes are additive; old clients display unknown cards. Any protocol gate needed for final native boundaries will be documented before completion. No deployment is authorized.

## Research and environment

- Read `CLAUDE.md`, goal/discovery, web PRODUCT/DESIGN, MCP setup and existing model, patch/undo, sync, authorization, share, proposal, canvas and Tauri entry points. No applicable `AGENTS.md` found in this worktree.
- `paseo-progress show`: CLI available, but reports “The progress plugin is not installed in Paseo, or Paseo is not reachable.” No matching run can be inspected/continued. QA remains here until that service is available.
- Impeccable context loaded from `apps/web`; incumbent Warm Den tokens/components are authority. Existing design sidecar is stale; outside this goal.
- Installed: Claude Code **2.1.310** (`/Users/oreo/.local/bin/claude`); Codex CLI **0.163.0** (`/Users/oreo/.local/bin/codex`). `--version`, help and generated Codex app-server schema inspected. Claude live answer succeeded; both execution adapters are implemented. Codex is pinned to 0.163.0; no live Codex model request has been made.
- Official research (2026-10-25): [Claude CLI reference](https://code.claude.com/docs/en/cli-reference), [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [subscription help](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), [Codex app-server](https://developers.openai.com/codex/app-server). Claude help permits installed CLI/SDK/third-party usage within existing limits, while SDK overview still prohibits offering third-party claude.ai login without approval. Integration will invoke an already configured local CLI, offer no embedded login, copy no credentials, and make no billing/entitlement promise. Authentication and the exact live result are recorded below; the documentation discrepancy is not treated as a promise of subscription entitlement.

## Findings

| Severity | Reproduction / finding | Fix / check |
| --- | --- | --- |
| High | Whole-card conversation content would be overwritten by per-field sync and exposed in public snapshots. | Dedicated append API, immutable source records, run ownership key and public chat allowlist; pure/SQLite tests pass. |
| High | Existing board-scoped MCP can read unlinked material. | No board MCP is connected. Claude live initialization reported `tools: []`, `mcpServers: []`. Codex disables inherited MCP by name and validates the effective inventory before inference; production driver passes the synthetic isolation probe. Real configured-model verification remains pending. |
| High | The server card-type allowlist rejected new chats, despite pure/API fixtures passing. | Register chat in the ordinary sync boundary; actual Worker browser tests now pass the creation loop. |
| High | Ask about selection opened the new chat before it synced, so the first read failed and no context was captured. | Initial context refresh drains sync before loading history. The browser bridge tests reproduced and verified the fix. |
| Medium | A card measured its height during branch creation; a single sync returned with a legitimate follow-up still queued. | Drain up to four sync rounds; WebKit branch/save/proposal tests pass after the fix. |
| Medium | Automatic source-height updates invalidated inspected text although no context text changed. | Context matching hashes identity and supplied text, while each saved turn records the fresh source revision; added a real SQLite regression. Actual content edits still require reinspection. |
| Medium | Phone inspector/composer could clip bottom controls; task-draft inputs were below 16px. | Bound the phone inspector, use visual-viewport bounds and 16px draft inputs; the final phone layout clears actual floating tools; six repeat workflows pass without retries. |
| Medium | Streaming displayed two assistant headers for one turn. | Stream into its existing message; the final on-board fixture captures show one assistant heading. |
| Medium | Saved provenance used a relative hash, which the existing safe Markdown renderer correctly removed. | Generate an absolute authorized board/chat link; clicking it opens saved history without execution. Browser popup check covers the existing external-link behavior. |
| Medium | A pending send could continue after Stop if preparation completed late. | Check cancellation before and after native startup; Stop does not wait for the dialog's general busy flag. Native startup timing remains to verify later. |
| Medium | Retained native process handles could be signaled again after exit. | Guard terminal Stop and check `try_wait()` before signaling a process group; native walkthrough deferred. |
| Test fixture | An “anonymous” new browser context inherited the project's saved sign-in. | Explicit empty storage state; keep the expected 401 assertion. |
| Test fixture | The note-editor test ID is on the CodeMirror content itself, not its parent. | Fill that actual editable element; preserve the real-input assertion. |

## Exact checks and artifacts

| Command / check | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed outside the network-restricted sandbox; no lockfile dependency changes. |
| `pnpm typecheck` | Passed repeatedly across all workspace TS packages. |
| `pnpm test` | **38 files / 327 tests passed** in the final unit run before the UI redesign. Typecheck also passes with the inline UI and phone framing helper. |
| `pnpm exec vitest run packages/core/src/chat.test.ts apps/server/src/chats.integration.test.ts` | **15 tests passed** after adding the layout-only source-version case. Includes actual migration SQL, D1-style atomic rollback, permission races, proposals and branches. |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --offline` | **12 passed / 1 ignored (0.36s)**. Parser/handshake, actual child streaming/Stop, pending questions, malformed events, rate-limit, stdin delivery and bounded metadata tests. The ignored installed-CLI test is run explicitly by the synthetic endpoint probe below. No native GUI testing. |
| `pnpm build` | Mac release binary and `.app` built; script failed at `hdiutil create`: **Device not configured**. Not a passing integrated build. |
| `pnpm --filter desktop build:local` | Passed; local test `.app` bundled. No production deployment or installation. |
| `E2E_PORT_OFFSET=60 pnpm --filter web exec playwright test agent-canvas.spec.ts --project=chromium --project=webkit --workers=2` | **4 passed** after the initial sync/branch fixes (earlier slice). |
| `E2E_PORT_OFFSET=60 pnpm --filter web exec playwright test agent-canvas-runtime --project=chromium --project=webkit --workers=2` | **4 passed**: fixture streaming/follow-up/Stop/reload and zero per-token board mutations/writes. This is not native or live-provider evidence. |
| Expanded web matrix | **16 passed (1.2m)** in Chromium/WebKit/iPhone/Pixel after the layout-version and visual fixes. Includes drag context-link undo/redo, recovery and neutral export. |
| `impeccable detect --json ...ChatCard.tsx ...ChatPanel.tsx ...chat.css` | Empty finding list before later visual fixes. Later changes are reviewed manually; no second detector run. |
| `git diff --check` | Passed before the latest small edits; rerun at handoff. |

### Live provider result (separate from browser fixtures)

- Claude Code 2.1.310, existing local **`claude.ai`** login. No login UI or credential extraction was added. `claude auth status` outside the sandbox returned `loggedIn: true`, `authMethod: claude.ai`; the restricted sandbox could not read that login and returned false. Do not mistake the sandbox observation for a missing user credential.
- Isolated temporary working directory; `--restricted --print --verbose --output-format stream-json --include-partial-messages --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --disallowedTools 'mcp__*' --disable-slash-commands --setting-sources "" --settings '{"disableAllHooks":true}' --no-session-persistence --permission-mode dontAsk` and an explicit text-only system prompt.
- Synthetic input named a sleepy corgi mascot and “book a park” as the first task. Answer: **“The mascot is a sleepy corgi, and the first task is to book a park.”** Exit 0, 3.07 seconds, 13 streaming events. Initialization reported **no tools and no MCP servers**.
- Reported usage: 2 uncached input, 648 cache-creation input, 34 output tokens. The adapter sums input/cache counters for its displayed total. No secrets or raw session diagnostics are stored here.
- Codex login status reported ChatGPT authentication. Its generated schema was inspected. `tools.disable_defaults` and top-level `disable_native_tools` are **not accepted** by installed 0.163.0 under `--strict-config`; probes used an invalid model provider and did not run a model. Do not copy those unrecognized switches into a supposedly isolated adapter.
- Missing: live follow-up, branch and cancellation through the actual app; all live Codex behavior. Browser fixture success does not close those criteria.

### Codex isolation spike — no live inference

Reproducible probe: `python3 docs/qa/agent-canvas/codex-isolation-probe.py /Users/oreo/.local/bin/codex` — **passed all three cases** on 0.163.0. It uses a separate temporary home/config, a synthetic MCP command that touches a temporary marker, a fake key and a loopback Responses fixture. No real account, credential file or paid model is used.

- `features.multi_agent_v2={enabled=true,disable_native_tools=true}` is accepted under `--strict-config`; unlike the previously rejected top-level setting, it removes shell/apply-patch tools in the captured request. Explicit feature controls also remove image, goal, app, plugin, memory and shell capabilities. The remaining advertised tool is `request_user_input`; this is **not** a zero-tool result, and requires a bounded input-request policy before shipping an adapter.
- **Important failure control:** `mcp_servers={}` merges with the inherited config. The synthetic MCP command actually starts and the request advertises MCP resource tools. An empty map is therefore not an isolation boundary.
- `codex exec --ignore-user-config --ignore-rules` prevents the inherited MCP trap. Installed help states that authentication still uses the configured `CODEX_HOME`. `app-server` rejects `--ignore-user-config`; do not assume it shares that isolation option.
- The fake endpoint sends a text delta, but `exec --json` emits its agent message as a completed item. This probe establishes neither incremental text streaming nor real-model tool metadata: the synthetic model used fallback metadata. Do not claim adapter parity from it.
- **Successful app-server spike:** initialize, read effective config with `config/read`, enumerate inherited MCP names, then supply `{mcp_servers: {eachName: {enabled: false}}}` in `thread/start.config` before starting the turn. The trap does not start before thread creation or during the turn; captured requests advertise only `request_user_input`; `item/agentMessage/delta` arrives and the turn completes. This proves a candidate transport with synthetic config and fallback model metadata, not production adapter parity or behavior under every managed policy.
- The production adapter now implements the bounded handshake and scoped input-request policy described below. Effective isolation against the configured real model remains unverified until native/live testing resumes; no credential is proven missing.

Official references rechecked: [app-server protocol](https://developers.openai.com/codex/app-server) and [configuration reference](https://developers.openai.com/codex/config-reference). The installed CLI help and captured fixture requests establish the version-specific findings above; the official reference alone does not document the full isolation recipe.

### Browser regression and redesign checks

- Pre-redesign full CI-style E2E: **1,039 passed, 5 failed, 2 flaky, 8 skipped (15.8m)**. This is not a passing full suite. Four failures came from the added Chat tool: old phone Add tests expected 12 actions and a lone full-width final tile. The updated tests assert 13 actions, the extra 48px row and identical grid widths. The remaining failure was Chromium competing drag/resize propagation; it passed the focused rerun in both engines, with no weakened assertion. Flaky cases were WebKit offline merge and Chromium sticker double-tap.
- First inline-card pass: **15 passed / 5 failed**. Found a real error-visibility bug (the context error lived in the hidden composer), an inaccessible phone activation control behind the selection dock, and two new permission fixture mistakes. Error moved above the body; phone Add now activates the inline composer synchronously. View tests detach the board from legacy inherited edit access and use the actual shares-list endpoint.
- Second inline-card pass: **18 passed / 2 failed**. Both failures were the fixture's nonexistent member-list URL; corrected for the final rerun. Source recovery, both phone layouts, streaming/follow-up/Stop/reload, offline final-result recovery, branch/save/proposal and sharing/export all passed this pass.
- Focused inline matrix: **25 passed / 1 flaky (26 tests, 1.4m)**. The old phone Add failures and Chromium competing drag/resize case all passed. Pixel framing failed once at x = −27, then passed retry; independent visual review required a real fix. The post-review 26-test run again passed 25 + 1 flaky and exposed native focus scrolling inside the outer `overflow:hidden` card. The paper now uses `overflow:clip`; a subsequent **six phone repeat runs passed with retries disabled (48.7s)**. These assert repeated bounds, overlay intersections, contained touch scroll, reopening and keyboard dismissal. The complete follow-up suite result is recorded below.

### Complete inline regression and final fix

`CI=1 E2E_PORT_OFFSET=60 pnpm test:e2e --workers=4`: **1,043 passed, 3 failed, 4 flaky, 8 skipped (12.3m)**. Not a passing full suite.

- Both engines failed the populated-board activation case. A direct WebKit reproduction found the newly placed chat's header at **y = −302**: free-space placement could choose a spot above the viewport. Click/keyboard creation now frames the new chat using the existing helper; dragging retains its chosen placement. Added a complete header-control-in-viewport assertion. This fix landed after the full-run bundle was built.
- Chromium `polish.spec.ts` / “Sync now says it is syncing…” failed because “Syncing…” did not become “Synced” within its existing 10s limit. The final focused rerun includes this case without changing its limit.
- Flaky on retry: WebKit live polling count, Chromium competing drag/resize, iPhone share-sheet keyboard, Pixel sheet regrab. A separate real-browser resize reproduction hit the actual handle, rendered width 350 locally and received width 350 remotely within the existing 1s check. No resize or sync assertion was weakened.
- The final production-browser run uses one worker and no retries, includes all agent flows plus failed/related cases, and rebuilds the latest fixes: **32 passed (1.8m)**. This includes the new header-in-viewport assertion, Show note revealing its output before undo/redo, real provenance popup navigation, branch/task proposal, streaming/Stop, offline recovery, access revocation, phone touch/keyboard checks, Add grids, polling, sync status, competing drag/resize and share-sheet keyboard cases. The complete suite is not being represented as passed because selected reruns succeed.
- The preceding single-worker pass was 31/32: WebKit could not click the saved-note provenance link while its output was partly outside the viewport. “Show note” previously only selected the result. It now uses the existing reveal-card navigation; the test invokes that real action and requires the full note in view before undo/redo and clicking provenance. No popup or visibility assertion was removed.

### Final-source complete browser follow-up

`CI=1 E2E_PORT_OFFSET=60 pnpm test:e2e --workers=4`: **1,047 passed, 1 failed, 2 flaky, 8 skipped (12.0m)**. Both populated-board activation cases and saved-note provenance now pass. This remains a failing complete run; the two fixture corrections below landed after their cases had executed.

- The sole failure was again Chromium's sync-status case, on both attempts. A separate browser against the same still-running, populated Worker recorded **25 sync responses in 12.6s**, repeatedly restarting paginated snapshots as other tests advanced the global access revision. The test injected 400ms into every page, perpetuating that churn. It now delays **one request per explicit sync**; the 10s completion, spinner, opacity and manual-retry assertions are unchanged. A direct check with that narrower latency fixture reached “Synced” in **521ms** against the same database; that check saw no access reset during its measured request pair.
- Chromium's context-drag case passed on retry after its initial direct fixture write was rejected before any drag. It now uses the repository's existing `postSync` helper (which only retries 409 authorization conflicts), and failed responses include status/body. The original rejection's status was not captured, so a 409 is an inference rather than a recorded fact. Drag/context/undo/redo assertions remain intact.
- Chromium's Boards navigation case passed on retry after a label bounding box returned null. No production navigation code or assertion was changed. This remains recorded flaky evidence, not a proven pre-existing issue.
- All conversation runtime, history, permission, save/branch/proposal and phone cases passed; the context-drag case required the retry described above. Browser fixtures remain distinct from real provider execution.
- Reopened the latest Chromium dark/light captures after this complete run: the thread and composer remain inside the single note beside the source. No UI production code changed during this continuation. Removed 138 unrelated sticker PNGs generated by the complete suite, retaining curated conversation evidence.
- Final correction run: `CI=1 E2E_PORT_OFFSET=60 pnpm --filter web exec playwright test agent-canvas.spec.ts agent-canvas-runtime.spec.ts mobile-agent-canvas.spec.ts polish.spec.ts visual-navigation.spec.ts --workers=4 --retries=0` — **40 passed (1.2m)**. Both corrected fixtures and the navigation case pass, together with all conversation and phone flows. Reopened fresh Pixel context and iPhone simulated-keyboard captures; note bounds and controls remain clear of floating tools. This selected run does not replace the complete-suite result.

### Performance evidence

`PERF_HEADED=1 E2E_PORT_OFFSET=60 pnpm --filter web exec playwright test 'e2e/perf.spec.ts' agent-canvas-performance.spec.ts --project=chromium --workers=1`: **2 passed (1.3m)**. No budgets changed.

- 1,000 conversation cards: 60 mounted at 100%, zero transcript HTTP reads, 13 MB JS heap; fit view uses LOD with no card DOM.
- Existing 1,000-card / 300-image fixture: 431ms load, 35 cards mounted at 100%, 15 MB heap, pan p95 10.0ms against an observed 8.3ms display frame and its existing 1.25× budget. Zoomed-out pan p95 10.1ms. Zero card DOM/full images in fit view.
- These measurements preceded only the phone framing/hit-area fix. That helper runs on activation/focus and does not add per-frame/per-token work.

### Visual review

Curated evidence is in [screenshots](screenshots/). The original dialog captures are being replaced by the on-board implementation. Reviewed the streaming note beside its connected source, desktop dark/light completed-thread captures, Pixel light source inspection and simulated-keyboard captures. The thread remains in the board's visual vocabulary and its composer fits inside stable geometry. A capture initially caught the transient “waiting to save” state; final captures now wait for server acknowledgement and change themes using the real account control. The phone tap flash is suppressed on chat controls. Final desktop dark/light and all four updated phone captures were opened and checked. Native visual review remains deferred.

## Remaining work and prerequisites

- **User steering:** only web interaction/testing for now. Native automation opened the local app at sign-in but stalled; no native conversation loop was completed. Do not request native access or count this as a credential blocker while independent web work remains.
- No required provider credential is currently proven missing. Live Claude worked outside the sandbox; Codex is signed in. Both adapters are implemented; live Codex and in-app provider parity remain verification gaps, not missing-user-input blockers.
- The latest full web run and corrected-source 54-test matrix are recorded below. Its single flaky send-conflict case has a deterministic correction verified in both engines; no clean full run of that last correction is claimed. Multi-user authorization, unsupported sources, chat-heavy structure and existing performance budgets already have evidence above; avoid repeating checks without a relevant change.
- Complete live provider follow-up/branch, native lifecycle/restart checks and final native engineering/visual review when that verification resumes. A fresh device intentionally fetches saved history only on activation. Keep every incomplete acceptance criterion open.
- The root build's DMG packaging needs an environment that can create the disk image, or a separately reviewed packaging fix. Local `.app` and browser builds are available now.
- Paseo Progress dashboard remains unavailable on recheck; no run was replaced. This QA record is authoritative for continuation.

## Inline UI finish review

Independent fresh reviewer disposition: **fix**. Desktop composition follows the confirmed note-style direction. Required changes: (1) frame the phone note above actual floating tools, (2) recover native focus scrolling and test repeated picker interactions, (3) restore 44px button/select hit areas, (4) document conversation behavior in DESIGN.md. The implementation now shares an unobscured-canvas rectangle between initial framing and keyboard recovery, resets unintended canvas-ancestor focus scroll, and uses stable 44px controls across input modes. The follow-up repeat run passed **6/6 with retries disabled** after the outer card changed to `overflow:clip`. The independent reviewer reopened all four updated phone captures and scored all four findings **resolved**, with disposition **ship this UI slice**. This is a scoped UI verdict, not a claim that the full regression or provider goal is complete. DESIGN.md documents the component without changing tokens or repairing unrelated sidecar drift.

### Previous handoff state — before Codex/input continuation

- Inline UI: scoped independent finish-review verdict **ship**, with the four material findings resolved. Existing design identity/tokens preserved; component behavior documented in DESIGN.md. Later creation/reveal fixes reuse the existing framing/navigation contracts and pass real-input browser checks.
- Latest browser check: **40 tests passed, four workers, retries disabled** after two fixture corrections; three Codex isolation probes pass with synthetic input and no real credentials/model. Prior verified checks: six repeated phone workflows, two performance tests, 38 unit files / 327 tests and workspace typecheck. `git diff --check` passes after the continuation. Production web and desktop-flavor browser bundles built as part of the browser runs.
- Full suite: latest complete run was **1,047 passed / 1 failed / 2 flaky / 8 skipped**, before the fixture corrections. Failed and related cases pass the final 40-test focused run; no clean complete run is claimed. No production UI source changed during this continuation.
- Original goal remains incomplete. Both adapters and their deterministic boundaries are implemented; real adapter parity/follow-up, native cancellation/quit/restart and final native walkthrough remain incomplete. Native testing is deferred under the user's web-only steering. Root DMG packaging also remains unverified after its recorded environment failure.
- No commit, deployment, publishing, account change or purchase. Unrelated screenshots generated by the full suite were removed; curated agent-canvas evidence is retained.


## Continuation — scoped questions and Codex adapter

Implemented the Codex 0.163.0 `app-server` stdio transport. Every run initializes, reads effective feature/MCP configuration, disables inherited MCP servers by name in the ephemeral thread, validates read-only/never-approval/private-cwd/instruction-source boundaries and checks the full disabled MCP inventory **before** `turn/start`. Unsupported versions or widened policy fail closed. Only correlated assistant text and provider usage reach shared state; reasoning and raw config/diagnostics remain local to Rust.

The sole permitted request is bounded `item/tool/requestUserInput`: at most three non-secret questions, five options each and explicit bounded answers. Other tool/approval requests fail recoverably. The note's inline form requires Send answer, keeps Stop available and saves visible Q&A into the answer so later follow-up/branches retain it. At this earlier stage, closing/reopening kept response drafts only within the app session; reload restored the request but not its unsaved response. The subsequent review fixes below add owner/request-scoped durable drafts without automatically answering or launching another run. The passive note labels waiting input. Input/response IDs are scoped to owner, device, run and request; the raw provider RPC ID never reaches JS.

Native metadata discovery uses bounded nonblocking pipes, including Codex's stderr login status. Its actual IO loop requires the full input to have been delivered before reporting success, validates terminal process exit and kills actual process groups on Stop. Pending answers reauthorize through the Worker, progress/finish writes are serialized and IndexedDB binding saves/deletes are ordered so a delayed IPC response cannot resurrect a completed run. Listener initialization can retry after failure.

### New checks

- `pnpm typecheck`: passed after the initial input UI; rerun after the recovery correction pending below.
- `pnpm test`: **38 files / 327 tests passed** after the finish-error allowlist added `tool-request`.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --offline`: **12 passed / 1 ignored (0.36s)**, including actual children waiting for input and streaming cancellation. The ignored test needs an explicit loopback model fixture.
- `python3 docs/qa/agent-canvas/codex-isolation-probe.py /Users/oreo/.local/bin/codex --rust-adapter`: **passed**. The original three probes plus the actual production Rust driver run installed Codex with separate temporary HOME/CODEX_HOME, fake credentials and a loopback Responses endpoint. Two allowed runs complete with only `request_user_input` advertised; inherited MCP traps never launch. Explicit base/developer instructions replace synthetic config/model-file instructions; marker checks prove those contents never enter captured requests. A synthetic global `CODEX_HOME/AGENTS.md` is reported in `instructionSources` even with `project_doc_max_bytes=0`; the adapter **refuses it before inference**. This is a compatibility limitation, not a passing global-instruction exclusion claim. No real model or credential was used.
- `CI=1 E2E_PORT_OFFSET=60 pnpm --filter web exec playwright test agent-canvas.spec.ts agent-canvas-runtime.spec.ts mobile-agent-canvas.spec.ts --workers=4 --retries=0`: **24 passed (59.2s)** before the following full-suite recovery correction. Covers pending reload, scoped answer, completion during IPC reply, saved Q&A follow-up, Stop and failed-listener retry.
- Reviewed fresh Chromium question captures in both themes: [light](screenshots/questions-chromium-light.png), [dark](screenshots/questions-chromium-dark.png). Form/Send answer/Stop fit inside the note; controls retain 44px targets and 16px input. WebKit captures are also retained. The earlier independent ship verdict covers the original inline redesign. A fresh form review required four fixes; all are implemented and the final 24-test matrix passes. The reviewer scored all four fixes **resolved**, with disposition **ship** at that fix-set scope.

### Findings from this continuation

| Severity | Finding | Fix / evidence |
| --- | --- | --- |
| High | An early-exiting provider could emit a completed answer after accepting only part of stdin. | Require successful full-input delivery before completion; actual Claude-shaped child fixture checks both cases. |
| High | Inherited Codex MCP config merges with empty maps; global instructions can widen context. | Enumerate and disable every inherited MCP, inspect inventory, refuse nonempty instructionSources. Synthetic production-driver probe passes; configured real-model metadata remains unverified. |
| Medium | Opening a waiting note tried to focus a composer that is absent during a provider question. | Optional focus guard; 24-test browser pass covers reopening. Also guard the post-send animation-frame focus when a question arrives immediately. |
| Medium | A completion during an answer IPC reply could be followed by a stale recovery binding save. | Serialize binding writes/deletes and ignore saves after binding removal; both browser engines verify no remaining run key after delayed reply. |
| Medium | Full-suite WebKit pending-reload test becomes interrupted. Two checkpoint hazards were found in review: progress counters were saved before incrementing, and all 409s (including transaction revision contention) stopped the run. Exact triggering response was not captured, so attribution to either hazard remains an inference. | Reserve counters durably before HTTP; retry only the explicit transaction-conflict response up to twice through fresh server authorization. Denial and expired-run responses still stop. Add a deterministic conflict during pending reload plus durable-counter assertions; final 24-test matrix passes with retries disabled; source/response attribution for the original full-suite interruption remains an inference. |

Complete browser follow-up: `CI=1 E2E_PORT_OFFSET=60 pnpm test:e2e --workers=4` — **1,051 passed / 2 failed / 1 flaky / 8 skipped (11.7m)**. This bundle precedes the checkpoint/finish correction. Failure 1 is WebKit pending-question reload, described above. Failure 2 is Chromium's headed multiplayer lifecycle fixture: its `document.hidden` predicate stays false after another native Chrome target is brought forward, before the application presence assertions. It fails both initial and retry. Pixel's existing to-do post-sort tap guard failed once and passed retry. Neither failure is being called pre-existing without evidence.

Corrected-source run: `CI=1 E2E_PORT_OFFSET=60 pnpm --filter web exec playwright test agent-canvas.spec.ts agent-canvas-runtime.spec.ts mobile-agent-canvas.spec.ts multiplayer-lifecycle.spec.ts mobile-todos.spec.ts --workers=4 --retries=0` — **30 passed / 1 failed / 1 skipped (1.1m)**. All 24 conversation tests and all six phone to-do tests pass. The same Chromium native-tab visibility predicate still fails; the WebKit version is explicitly skipped by that fixture. Assertions/timeouts were not weakened. The question test now injects one recoverable transaction conflict during reload and one during completion, asserts the counter was reserved in IndexedDB before HTTP, checks no native Stop was sent, and requires the saved result to remain completed. A clean complete suite is still not claimed.

Latest default Rust check: **12 passed / 1 ignored (0.33s)**. The final production-Codex synthetic probe passes again with shell snapshots and remote control explicitly disabled/validated. Workspace typecheck and diff whitespace check pass after the recovery correction.

Final local build and scoped form-review results are recorded below. Native walkthroughs and live provider follow-up/branch remain deferred; root DMG packaging remains open.


### Final form fix verification

The fresh independent form review returned **fix** for four material items. The fixes retain the same note and tokens:

1. Suggestion selects keep native behavior with `appearance: none`, explicit 44px height and the incumbent Phosphor chevron. Both engines measure **348 × 44 CSS px**; no target threshold was lowered.
2. Conversation focus ownership survives the composer-to-question handoff, but delayed autofocus checks that focus has not moved to another card. The test edits a real second note, receives a question, keeps typing and requires the editor to retain focus and content.
3. Suggestion and response fields disable during submission. A gated authorization POST proves both controls are disabled before the response is sent.
4. The context inspector keeps Stop in the note header. The first fix pass exposed its card-drag interception; the final header action uses the same pointer protection as Close and the test clicks it, requires the form to disappear and saves an interrupted result.

Intermediate fix runs: **22 passed / 2 failed (1.1m)** caught the new header Stop drag interception; **9 passed / 1 failed (1.1m)** then caught Chromium's transient body-focus handoff. These were fixed rather than relaxing assertions. Final `CI=1 E2E_PORT_OFFSET=60 pnpm --filter web exec playwright test agent-canvas.spec.ts agent-canvas-runtime.spec.ts mobile-agent-canvas.spec.ts --workers=4 --retries=0`: **24 passed (1.3m)**. Workspace typecheck passes after the final focus fix. Refreshed all four question theme captures and added [Chromium inspector](screenshots/questions-inspector-chromium.png) / [WebKit inspector](screenshots/questions-inspector-webkit.png) evidence. A fresh documenter checked the final handlers and updated DESIGN.md; existing sidecar drift remains outside scope.

The remaining full-suite Chromium visibility failure also reproduces with **two `about:blank` pages, no DoggyNote code loaded**, using the fixture's same native Chrome launch, `connectOverCDP({noDefaults:true})`, `Target.createTarget({newWindow:false})` and `bringToFront()` sequence. Observed control: `initialHidden:false`, `afterOtherTargetFront:false`, `secondHidden:false`. That supports an environment/fixture limitation before application presence behavior, not a passing multiplayer lifecycle check. Its full-test assertion and timeout remain unchanged. The phone post-sort tap case passes the focused rerun; it remains recorded as flaky in the complete suite.

Removed **138 generated untracked sticker PNGs** from the full suite; preserved tracked files and all curated conversation evidence. No native app was opened, live provider request made, credential copied, commit created or deployment performed in this continuation.


### Continuation handoff

- **User-facing result:** the whole thread, composer, context inspection and provider questions live inside one note-style board object. Sources stay beside it; closing the view preserves work. Existing Warm Den tokens and themes remain intact.
- **Fresh finish-review verdict:** **ship**, specifically scoring Stop reachability, focus ownership, sending state and WebKit sizing **resolved**. This fix-set verdict is not whole-goal acceptance. The documenter rechecked the final source and updated DESIGN.md; pre-existing sidecar drift was left untouched.
- **Final focused web result:** **24 passed, four workers, retries disabled (1.3m)**. Tests cover both engines and iPhone/Pixel workflows, scoped clarification responses, conflict/reload recovery, another note retaining typing focus, 44px controls and Stop through context inspection. Typecheck and `git diff --check` pass. Prior current unit result: 38 files / 327 tests. Native default tests: 12 passed / 1 ignored; opt-in installed-Codex synthetic production-driver probe passes separately.
- **Build:** `pnpm --filter desktop build:local` **passed** after the final source, release Rust compile 19.12s, producing the local `DoggyNote.app` (14.24 MiB). No app launch or installation. This does not repair or replace the earlier root DMG packaging failure.
- **Integrated limits:** latest complete web run remains **1,051 passed / 2 failed / 1 flaky / 8 skipped**, before the later fixes. Its new chat failure is covered by the final passing matrix; its native-tab visibility assertion fails independently with no app loaded. No clean final-source complete suite is claimed, and the native visibility assertion was not skipped or weakened to obtain a pass.
- **Original acceptance gaps:** real Codex inference/follow-up, real Claude follow-up/branch through the app, native cancellation/quit/restart and visual walkthrough remain deferred under the user's web-only steering. Global Codex instruction files are intentionally refused before inference; configured real-model isolation remains unverified. A clean complete web regression and root DMG packaging also remain open. The original goal is incomplete.
- Reviewable local diff only. No commit, deployment, publishing, account change or purchase.


## Requested code, UX and design review fixes — 2026-10-25

The user requested fixes to the three independent reviews. The thread remains one Warm Den note-style board object beside its sources. No new tokens or design world were introduced.

| Review finding | Implemented fix and evidence |
| --- | --- |
| Code, high: deleting an author deleted shared exchanges; ordinal gaps could collide with the next append. | Additive SQLite/D1 migration `0016_retain_chat_authorship.sql` preserves every turn column and both indexes while retaining the immutable opaque author ID without a user FK. Live-user authorization is unchanged. Append uses max ordinal + 1; replay slices by the chosen turn’s position rather than ordinal. Production-migration/API tests retain mixed-author history after account deletion, append after ordinal 7 at 8, exclude future replay text, preserve upgrade rows/event sequence, enforce one active run and pass FK checks. |
| Code, medium: logout could orphan a native process or erase an unsaved result. | Stop native runs and drain checkpoints/final saves before revoking credentials/resetting IndexedDB. Surface a recoverable error if a nonempty answer cannot finish saving. Native shutdown closes a registry barrier and advances a session epoch, so queued pre-logout startups cannot spawn after a new login. Credential clear and app exit also shut down. Actual child-process test verifies shutdown and stale-epoch rejection; both browser engines require terminal local runs and a saved interrupted partial before logout HTTP. |
| UX: sending could erase a newly typed draft or steal focus from another card. | Clear only the submitted draft version; delayed composer focus requires continued focus ownership. Gated HTTP test types the next prompt and edits another real note while send waits, then verifies focus/content and the retained prompt. |
| UX: unsent prompt/question responses disappeared on reload. | Local owner/conversation/request-scoped bounded storage, explicit storage-failure alert, question cleanup only after acknowledged response, owner-only cleanup on logout. Browser tests reload both prompt and question drafts and ensure a new question starts empty. |
| UX: run changes were silent to assistive technology. | Persistent visually hidden polite/atomic status region announces state transitions and save recovery, without per-token chatter. Source and rendered DOM reviewed; no live screen-reader session is claimed. |
| UX: saved provenance reopened only the conversation, not the referenced answer. | Validate the message target, reveal/focus/highlight that exact saved turn inside the thread, without executing a provider or moving the canvas. Both engines verify existing saved-note links and a long five-turn target. |
| UX: conversations lacked names; stale context had an unclear recovery path. | Inline editable title uses ordinary undo/sync; opening the source inspector refreshes it. A mismatch opens inspection with an explicit “Inspect updated context” action. Browser title/reload and existing context edit/recovery checks pass. |
| Design: short answers’ actions were buried; source-toggle state and inspector hierarchy were weak. | Keep stable 380×520 geometry, compact spacing, put answer actions before collapsed context/usage, collapse healthy provider details. The selected source control says “Back to thread”; source revision is inline and explanatory help follows the source list. Full answer-action visibility is asserted. All 16 refreshed theme/engine/phone captures were independently reviewed. |

The thread follows streaming while the reader remains near the bottom; scrolling up releases following, and precise-message navigation does not trigger following. The existing 80-update test still requires zero mutations outside the conversation and zero board-sync writes. No additional per-token canvas layout was added.

### Verification and independent verdicts

- Focused core/SQLite API checks: **17 passed**. Full `pnpm test`: **38 files / 329 tests passed (1.54s)**.
- Final `pnpm typecheck`: **passed** across the workspace.
- Default Rust tests: **13 passed / 1 fixture-only test ignored (0.29s)**, including the actual child/session-epoch test. No native GUI was opened.
- Installed-Codex synthetic probe rerun after the native session changes: **passed**, including the actual production Rust adapter, fake credentials/temporary home, replaced model instructions, disabled inherited MCP and rejection of a global instruction file before inference. Only `request_user_input` was advertised in permitted runs. No live model request.
- Conversation/phone matrix: `CI=1 E2E_PORT_OFFSET=60 pnpm --filter web exec playwright test agent-canvas.spec.ts agent-canvas-runtime.spec.ts mobile-agent-canvas.spec.ts --workers=4 --retries=0` — **30 passed (1.0m)**.
- Broader integration: same command with `desktop.spec.ts accounts.spec.ts` added — **54 passed (1.2m)**. The generic desktop credential fixture now acknowledges the two new session commands; existing logout assertions were retained.
- Code reviewer: **both original findings resolved**, including migration preservation and native startup/logout synchronization. UX reviewer: **all seven original findings resolved**, plus source confirmation of stream following. Design reviewer: **all three original findings resolved; ship at the original fix-set scope**. These are bounded review verdicts, not whole-goal acceptance.
- The independent documenter checked the final handlers and updated [DESIGN.md](../../../apps/web/DESIGN.md). Pre-existing sidecar drift remains outside scope.
- Fresh visual evidence: [completed thread](screenshots/on-board-thread-chromium-light.png), [phone sources](screenshots/context-mobile-webkit-light.png), [inspector and Stop](screenshots/questions-inspector-webkit.png), with both themes/engines retained in the screenshots directory.

Full-suite result and final local build verification are recorded below. Original acceptance remains incomplete: native GUI/restart and live-provider follow-up/branch are deferred, and root DMG packaging has its previously recorded environment failure. No commit, deployment, publishing, account change or purchase.


### Full-regression follow-up: initial-send contention

The complete suite’s Chromium failed-subscription recovery test returned **409 “The conversation, context or access changed. Refresh and try again.”** before any local provider started (`started.length === 0`); the failure snapshot retained the unsent draft and displayed that exact alert. This is the generic atomic guard-conflict response. Shared access revision contention is a plausible source, but the exact SQL guard that lost the race was not captured.

Initial sends now use the existing bounded `postRun` retry, with the **same immutable Begin body/operation ID** and at most two retries. Each endpoint attempt reauthorizes and recaptures server context. Explicit stale-history/context, access denial, ownership and expired-run errors are not eligible. The original server idempotency contract remains unchanged. The existing subscription test now injects one generic guard conflict, verifies no native start before acceptance, identical request bodies and bounded attempts, then requires exactly one started run and completed answer. The full suite was already serving its built pre-correction bundle; corrected-source results are recorded separately below.


Complete regression: `CI=1 E2E_PORT_OFFSET=60 pnpm test:e2e --workers=4` — **1,059 passed / 1 flaky / 8 skipped (12.3m), exit 0**. The initial-send conflict above failed once and passed the configured retry; it is recorded as flaky, not a clean pass. All other executed cases passed, including Chromium’s native-tab visibility fixture, which had failed in the earlier runs/control recorded above. That current pass does not invalidate the earlier environment evidence. No assertions or timeouts were weakened. The browser bundle preceded the narrow send-retry correction; no clean complete run of that corrected bundle is claimed.

The independent code reviewer inspected the correction and found **no material authorization or idempotency regression**: at most three identical attempts, only the exact guard-conflict error eligible, fresh authorization before execution. Removed **138 generated untracked sticker PNGs** after the full suite; all tracked files and curated conversation screenshots were preserved. Paseo Progress remains unavailable on recheck; this QA record remains authoritative.


Final corrected-source integration: `CI=1 E2E_PORT_OFFSET=60 pnpm --filter web exec playwright test desktop.spec.ts accounts.spec.ts agent-canvas.spec.ts agent-canvas-runtime.spec.ts mobile-agent-canvas.spec.ts --workers=4 --retries=0` — **54 passed (1.4m)**. Both engines pass the injected initial-send conflict, with identical bodies, bounded retries and one native-fixture start. Account/logout, retained drafts/focus, exact provenance, Stop, source recovery, question reload, streaming isolation and phone controls pass together. Final workspace typecheck and `git diff --check` pass after the correction.


Final `pnpm --filter desktop build:local`: **passed**, release compile **21.36s**, local `DoggyNote.app` **14.20 MiB**. This verifies compilation/registration of the new native session commands. No launch, installation or native interaction. Existing Vite chunk-size and ineffective dynamic-import advisories remain nonfatal; root DMG packaging was not retried.

### Review-fix handoff

All original code, UX and design findings are resolved and independently verified at their stated scope. Final corrected-source integration **54/54 with retries disabled**; workspace typecheck, **329 unit tests**, **13 default Rust tests**, the opt-in synthetic installed-Codex production-adapter probe, local `.app` build and whitespace check pass. The full pre-correction browser bundle completed **1,059 passed / 1 flaky / 8 skipped**; the flaky send guard conflict is now deterministically covered in both engines. No clean complete run of the final narrow correction is claimed. Original native/live acceptance gaps and earlier root DMG environment limit remain open under web-only steering. The broader goal remains incomplete. Reviewable local changes only; no commit or deployment.

### PR review handoff

The user subsequently requested a PR for live review. Publish the validated implementation as a draft; no merge or deployment is requested. Its tested base is `534ea630`. Current `origin/main` is `7a0ceaec` and has since introduced synced notes, sketches and areas, including `0015_synced_notes.sql`. Integration with those changes, migration ordering and a fresh combined regression remain required before merge. The recorded test counts apply to this branch, not an integrated current-main tree. Native/live-provider and packaging limits above remain open.
