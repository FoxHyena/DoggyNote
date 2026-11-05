# Display-name verification

Implemented optional display names alongside stable usernames. The Account menu shows the visible name above `@username`; Edit profile uses the existing desktop dialog and phone sheet. Both invitation signup flows offer the optional field. Current names propagate through collaboration, sharing, administration and comment author identities without rewriting comment history.

## Checks

- `pnpm typecheck`: passed across the workspace.
- `pnpm test`: 646 tests passed across 62 files.
- Production web and browser-served desktop builds: passed during browser setup.
- Final focused Chromium/WebKit and phone run: **78 passed, no retries**, in 1.5 minutes. Command: `CI=1 E2E_PORT_OFFSET=100 pnpm --filter web exec playwright test profiles.spec.ts avatars.spec.ts desktop.spec.ts theme.spec.ts mobile-guides.spec.ts accounts.spec.ts --workers=2`.
- Impeccable detector: no findings. Independent source and visual review: ship, no material findings; the long-handle wrapping safeguard was also reviewed.
- `git diff --check`: passed.

Coverage includes cancel, retry, acknowledged saves, clearing, reload, offline fallback, cache isolation, invalid input, duplicate names, Unicode/emoji, maximum-length handles, both signup flows, cross-account collaboration, sharing attribution, existing comments, public viewers, unchanged stored authorship, and bearer-token saves across origins. Existing photo editing, theme controls and account keyboard navigation were included.

## Full-suite limitation

The full six-worker CI browser run completed in 24.9 minutes: **1,468 passed, 22 passed on retry, 14 failed, 17 skipped**. It began before the pagination and keyboard-order test corrections. The corrected profile/theme tests pass in the final focused run. Other failures involved multiplayer timing, agent geometry, sketches, sticker suggestions and icon controls; they were not repaired as part of this feature. The complete result list is in [full-suite-summary.txt](full-suite-summary.txt). This work does not claim a green full suite.

Six selected existing tests also passed against the original application in a separate two-worker run. That comparison does not establish a clean full-suite baseline. Browser-served desktop behavior was tested; no native Mac build or physical-device keyboard walkthrough was performed.

## Visual evidence

The nine PNGs in this directory show Account and Edit profile on desktop (1280×720) and phone (393×659), in both themes, plus the editor at 320×480. Captures use reduced motion to avoid partial sheet entrances. Existing tokens, avatar controls and Warm Den styling are preserved.

## Release order

Apply `apps/server/migrations/0020_display_names.sql` before deploying the updated Worker and web app. The change is additive and needs no minimum-client bump. Existing accounts retain their username fallback. Deployment was not performed.
