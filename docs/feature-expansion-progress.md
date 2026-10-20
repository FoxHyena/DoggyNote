# DoggyNote feature expansion

Previous feature expansion status: complete. All seven features are implemented; automated verification, manual feature walkthroughs and the freshly rebuilt native bundle smoke check pass.

The Paseo progress service was unavailable, so this repository file records the work and evidence. Accounts, sharing and MCP were implemented and reviewed by orchestrated agents; the primary agent integrated sync, durability, graphics and board interactions.

| ID | Feature | Result | Manual evidence |
| --- | --- | --- | --- |
| T01 | Admin dashboard, invitations and recovery | Complete; People/Invitations, single-use signup, reset links, session and agent revocation, final-admin protection | Native dashboard and keyboard flow; generated invitation → fresh browser signup → empty private home |
| T02 | Private boards and sharing | Complete; personal homes, legacy shared-space migration, username view/edit grants, seven-day editing links and revocation | Username recipient edited a shared board; signed-out Fido accepted an editing link, signed in and contributed |
| T03 | Paw/dog graphics | Complete; SVG brand, dog loader, navigation and native icons | Browser/native visual reviews, light/dark and narrow layouts |
| T04 | Buried bones badge | Complete; notification-style number removed | Bury/restore reviewed; native and browser button has no badge |
| T05 | Board selection and opening | Complete; click selects, Enter renames, double-click or Open enters; viewer retains single-click opening | Native selection/rename/double-open and browser explicit actions |
| T06 | Local MCP connector | Complete; scoped revocable tokens, typed proposals, previews, approval/rejection, conflict-safe reversal | Official SDK → native four-object preview → approve → live cards → reverse → empty board; temporary credential revoked |
| T07 | Quiet sync and durable saves | Complete; quiet routine status, delayed slow-work indicator, details/retry/offline/recovery, atomic local saves and native shutdown | Full active text survived Cmd+W, red close and offline Cmd+Q/reopen; reconnect reached zero pending; native recovery Save dialog |

## Inbox and compact navigation follow-up — complete

The approved follow-up keeps Boards, Inbox and Share labeled; groups secondary actions in More and Account; moves undo, redo, zoom and snap into the canvas; preserves quiet save behavior and adds responsive layouts. Paseo progress remains unavailable, so progress stays here.

- Complete: Inbox naming and legacy title display, shared action panels, account theme choices — implemented by the existing agents.
- Complete: compact header, canvas controls, quiet title status and responsive layout. First visual round checked 1440/720/600/360 px in both themes; fixed narrow popovers, status text width and Safari menu keyboard handling.
- Verified: **263 browser checks passed, 3 intentional skips, no failures or flakes** across Chromium/WebKit; **125 unit tests** and full workspace typecheck pass. Production web and final isolated native builds pass. Native manual capture/place/undo/redo, zoom/snap, export Save dialog, appearance, Share, save details, proposal history and navigation passed. Final rebuilt app confirms Backspace safety, Tab/Escape focus and saved cards after restart.
- Two visual rounds passed. Fixes include narrow popovers, status text width, read-only canvas width, Safari Backspace behavior, save-details Escape and parent-navigation focus restoration. [27-image before/after gallery](../output/review/doggynote-navigation-review.html) · [QA notes and verification](qa/compact-navigation/README.md).

## Verification

- **253 passed, 3 intentionally skipped, 0 failed or flaky** in the complete real-Worker Chromium/WebKit suite. The skips are the two opt-in README screenshot cases and WebKit's Chromium-only performance measurement.
- **122/122 unit tests** across eight files, including actual SQLite migration, permission, proposal, revocation and reversal races.
- **66/66 repeated browser checks** for recovery, export and interaction behavior: three runs in each browser.
- Full workspace typecheck, production web build, native `cargo check --offline`, release workflow YAML/dependency validation, and `git diff --check` pass.
- Latest rebuilt native app shows both recipients' contributions and zero pending changes/uploads. [Final native smoke](qa/feature-expansion/native-final-current-build-sync.png).
- Performance fixture: 1,000 cards and 300 images; initial load 257 ms, pan p95 16.7 ms, overview pan p95 16.8 ms, 11 MB JS heap, 35 mounted cards at 100% zoom.
- Machine-readable results: [verification.json](qa/feature-expansion/verification.json).

## Product decisions delivered

- Personal boards start private; nested boards inherit parent access. Existing users retain the migrated shared space; new accounts do not join it automatically. Admins administer ordinary boards; other people's Toy boxes remain private.
- Username grants offer view/edit. Editing links require sign-in, accept recipients for seven days, and retain redeemed access until removal. Link revocation removes link-sourced grants. Signup through an editing link is owner-controlled and off by default.
- Account invitations are single-use for seven days. Password reset links are single-use for one hour; recovery and all-device revocation also disconnect agents.
- New public view links follow canonical nested boards; existing links retain their legacy scope behavior.
- Normal network sync remains fast (600 ms debounce, 10-second visible polling). Routine work stays visually quiet; sustained work, offline state and errors remain visible.
- MCP uses local stdio and 90-day scoped credentials. Agents can read and propose; people approve inside DoggyNote. Existing scoped image/file assets can be reused; uploading new bytes is outside this connector version. [Setup](mcp-setup.md).

## Visual QA and fixes

Two visual rounds reviewed browser and native layouts, light/dark themes, 600 px browser windows, reduced motion, keyboard focus, loading/errors and empty states. [Screenshots and descriptions](qa/feature-expansion/README.md).

The reviews fixed overlapping column headings, clipped narrow previews, crowded top-bar controls, low-contrast gold-note text, Safari dialog Escape handling, and canvas shortcuts leaking through dialogs. WebKit Backspace no longer navigates away behind a dialog.

Integration checks also fixed active-text durability during measurement saves, late layout callbacks recreating removed cards, incomplete recovery records, access changes racing permission reads, proposal author/field-removal authorization, private proposal history, and content racing reversal. Multi-device test sessions now close after each case rather than continuing to poll.

## Delivery notes

- Compiled screenshot review: [interactive gallery](../output/review/doggynote-flow-review.html) and [19-page PDF](../output/pdf/doggynote-flow-review.pdf), covering 18 captured states across six flows. PDF pages were rendered and visually checked; gallery filters, enlargement and keyboard navigation were checked at desktop and narrow widths.

- No production deployment or changes to production app data were performed. Manual tests use isolated QA app identifiers and a separate local database.
- Release staging now uploads versioned desktop artifacts first. Deploying the Worker selects its matching updater manifest; the fallback manifest and GitHub release publish afterward. Version minor 2, minimum client 0.2.0 and sync protocol 2 protect the access migration while preserving old clients' queued edits.
- The Dock menu is not exposed reliably by the desktop automation, so Dock-menu Quit was not separately exercised. Cmd+Q and native window closing both passed the native save/termination flow.
- Desktop bridge E2E verifies save-before-update, failure/retry, installation and restart ordering. A signed updater package was not installed during manual QA.


## Visual polish and QA cleanup — complete

The three requested workstreams integrated navigation, panels/dialogs, and canvas/entry cleanup. An independent reviewer completed a second pass on open, populated states. Paseo remains unreachable, so this file and the linked QA records are the progress tracker.

- Boards now uses explicit icon, label and permission slots, aligned supporting text, a separate header and a scrolling list. Navigation, export and canvas/entry styles have clear component ownership; old conflicting rules were removed.
- Fixed short-window entry/invitation clipping, crowded long names, selection/floating-control collisions, scrolling Comments, sticky-header bleed, error contrast and update/recovery overlap. Keyboard dismissal, restoration and Fetch Enter safety are verified.
- Full Chromium/WebKit suite: **301 passed, 3 intentional skips, 0 failures or flakes**. **125 unit tests**, workspace typecheck, production build including macOS DMG, and isolated native QA builds pass.
- Native manual checks cover full size and actual **720 × 480**, with traffic-light clearance, Boards, Account/appearance, Share, Export, selected/editable notes, Comments, and keyboard safety. Final rebuilt native restart/save/focus smoke and gallery checks passed.
- [Findings and state-by-state review](qa/visual-polish/README.md) · [Independent review](qa/visual-polish/review/README.md) · [Before/after gallery](../output/review/doggynote-visual-polish.html).
