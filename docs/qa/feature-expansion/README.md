# Feature expansion visual evidence

These screenshots use isolated local test accounts and data.

Compiled review: [interactive gallery](../../../output/review/doggynote-flow-review.html) · [19-page PDF](../../../output/pdf/doggynote-flow-review.pdf). Both include all 18 screenshots with flow ordering, captions and capture notes; final browser preview images use the latest full-suite captures. The gallery embeds full-resolution images and supports flow filters, enlargement and arrow-key navigation.

- `native-admin-dark.png`: People dashboard in the actual Tauri app.
- `native-invitations-dark.png`: empty invitation state in the actual Tauri app.
- `native-recovery-save-dialog.png`: native JSON recovery Save dialog.
- `mcp-proposal-dark.png`: proposed layout after column heading spacing fixes.
- `mcp-proposal-light-narrow.png`: 600px window, light theme and reduced motion, after preview clipping fixes.
- `mcp-connections-light.png`: scoped connection chooser with readable board labels.
- `native-mcp-proposed-light.png`, `native-mcp-applied-light.png`, `native-mcp-reversed-light.png`: actual Tauri preview, applied cards and reversal from the real MCP client proposal.
- `manual-invite-signup-private-home.png`: signup from an invitation opened an empty private home.
- `manual-username-share-edit.png`, `manual-editlink-fido-edit.png`: both recipients edited the shared board.
- `native-active-note-before-close.png`, `native-note-restored-after-cmdw.png`: full active text persisted across closing and reopening.
- `native-offline-active-checkpoint.png`, `native-offline-restored-after-cmdq.png`, `native-reconnected-zero-pending.png`: offline typing, quit/reopen recovery and successful reconnect.
- `native-final-current-build-sync.png`: rebuilt final source, both recipients' contributions present and zero pending changes/uploads.

Two visual rounds reviewed spacing, overflow, column contents, button placement, icon clarity and light/dark readability. The first round found column overlap, narrow preview clipping and top-bar crowding; the second confirms those fixes. Functional and native lifecycle acceptance is recorded separately in [the progress tracker](../../feature-expansion-progress.md).
