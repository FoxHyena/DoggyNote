# Visual polish and QA cleanup

Complete. Navigation, panels/dialogs, and canvas/entry workstreams were integrated, then reviewed independently on open, populated surfaces. The existing colors, icons, navigation structure, card content typography, permissions and server behavior are preserved.

[Open the before/after gallery](../../../output/review/doggynote-visual-polish.html) · [Every captured state and its review result](review-matrix.csv) · [Independent review](review/README.md) · [Verification](verification.json).

## Findings and evidence

Each row links a reproduction/reference and a corrected state. Detailed component findings are in [navigation](navigation.md), [panels/dialogs](panels.md), and [canvas/entry](canvas-entry.md). Those original workstream notes retain their initial verification history; the integrated results here supersede their pending-review notes.

| Surface and reproduction state | Before | Fix and reviewed result | After |
| --- | --- | --- | --- |
| Boards, empty/shared space, 720 × 480 | [Separated labels and inconsistent supporting inset](before/webkit-light-720-boards.png) | Fixed icon, flexible label and separate permission slots; grouped explanation; consistent header/section spacing. Approved. | [Aligned labels/descriptions](after/webkit-light-720-boards.png) |
| Boards, long names, many shared boards, short window | [Original menu structure](before/webkit-dark-360-boards.png) | Header stays visible while the body scrolls; names wrap without consuming permission metadata. Approved in both engines/themes/all five widths. | [Populated Boards evidence](navigation/) |
| More, Account, appearance, zoom, parent breadcrumbs and tooltips | [More](before/webkit-light-720-more.png) · [Account](before/webkit-light-720-account.png) | Dedicated navigation styles, 13px rows, 12px supporting text, explicit trailing shortcuts, bounded popovers and visible focus. Approved. | [More](after/webkit-light-720-more.png) · [Account](after/webkit-light-720-account.png) |
| Sharing/export, long metadata and short windows | [Original Share](before/webkit-light-360-share.png) | Wrapped names/metadata, independent action space, viewport positioning, scrolling and dedicated export styles. Approved; selection-disabled state retained. | [Final populated panel captures](integrated/) · [Native Export](native-export-light-720.jpg) |
| Agent/admin/sharing headings after scrolling; RV-01 | [Heading bleed evidence and reproduction](review/README.md) | Sticky header backgrounds cover top padding so list text cannot paint above them. Geometry and painted hit-testing regressions pass. | [Final supplemental headings](review/supplemental-inventory.json) |
| Agent error banner, dark appearance; RV-05 | [Muted error text](before-findings/agent-error-dark-360.png) | Supporting paragraph color excludes error banners; existing error text token restores measured contrast to 5.74:1 dark / 8.32:1 light. Approved. | [Corrected error captures/colors](review/supplemental-inventory.json) |
| Fetch, many long results, keyboard navigation | [Original populated search](before-extra/webkit-light-360-fetch.png) | Supporting text aligns below the title, search input shrinks, active results scroll into view, dismissal restores focus. Enter is prevented before navigation so it cannot activate the restored breadcrumb. Cross-board interaction tests pass. | [Final search captures](integrated/) |
| Inbox/Buried bones, 20 long items | [Original Inbox](before/webkit-light-360-inbox.png) · [Buried bones](before/webkit-light-360-trash.png) | Fixed headings/composer, scrolling list, dedicated action columns, wrapping descriptions, Escape/focus restoration. Approved. | [Inbox](after/webkit-light-360-inbox.png) · [Buried bones](after/webkit-light-360-trash.png) · [Populated states](integrated/) |
| Selected cards, narrow canvas and touch targets | [Original selected controls](before-populated/webkit-360-light-selection.png) | Non-shrinking controls scroll within canvas bounds; measured bar height avoids floating canvas commands; touch targets are at least 44px. Approved. | [Native selection](native-selection-light-720.jpg) · [Touch audit](touch/verification.json) |
| Comments after scrolling the selection toolbar; RV-02 | [Original clipped panel/reproduction](review/README.md) | Canvas clips without becoming a programmatically scrollable ancestor; reply focus does not pan it. Long author/time/body metadata wraps, and actions remain separate. Approved. | [Native populated Comments](native-comments-light-720.jpg) · [Touch regression captures](integrated/) |
| Signup, reset, sign-in, editing invitations at 480px high | [Recreated original entry layouts](before-entry/) | Scrollable entry container, safe centering, spaced nested forms, invitation explanation inside the same card. Submit and username remain reachable. Approved, including login error states. | [Final entry/viewer captures](integrated/) |
| Quick capture, 360 × 200 | [Original short-window capture](before-extra/webkit-light-360-capture.png) | Textarea shrinks within available height, status wraps without collapsing, visible focus retained. Approved in both appearances/engines. | [Final capture states](integrated/) |
| Column with an unbroken title | [Original card states](before-populated/) | Title wraps within the column header without changing content typography. All seven card types, note editing, comment editing, and notifications reviewed. Approved. | [Final card states](review/independent-inventory.json) |
| Optional update plus recovery details; RV-04 | [Recreated original overlap](review/RV04-recreated-before-optional-toast-visible.png) | Optional notice hides while an active surface needs the space, then returns on dismissal. Mandatory update remains modal. Recovery download passes hit-testing. Approved. | [Unobscured recovery actions](review/RV04-after-recovery-actions-clear.png) |
| Screenshots captured mid-animation; RV-03 | First-round evidence described in [review notes](review/README.md) | Capture waits for panel animation completion or disables animations. Final panels are opaque and explicitly inspected. | [Settled browser captures](after/) |

## Review coverage

| Group | States explicitly reviewed | Result |
| --- | --- | --- |
| Navigation | Boards empty/populated/long lists, long ancestry, More, Account and selected appearance, quiet/attention save details, zoom, tooltips, pending counts, keyboard dismissal/restoration | Approved |
| Canvas | Creation rail; note/link/todo/image/file/board/column; selected/editing controls; long column names; populated comments/editing; Inbox, Buried bones, notifications | Approved |
| Dialogs/forms | Populated sharing, export/disabled selection, people, all invitation statuses, long device sessions/reset links, agent connections/errors, populated proposals/current/proposed/expanded changes/decisions, loading, recovery, optional/mandatory update | Approved |
| Entry/viewing | Login/error, signup, reset, editing invitation, quick capture, populated public viewer/open appearance, populated account view-only board | Approved |

Both Chromium and WebKit were reviewed in Light/Dark at **1440, 1024, 720, 600 and 360px**, including **480px high** windows. The final touch audit checks 20 browser/theme/width combinations for 44px targets, containment and header-control separation. Independent review inspected populated content and controls in addition to viewport geometry; [its record](review/README.md) distinguishes first-round findings, final captures and native screenshot review.

Native walkthrough used isolated local **DoggyNote Visual QA** and **DoggyNote Small QA** bundles against a separate QA server. The small app opens an actual **720 × 480 native window**, with the same 720/480 minimums. Full-size and minimum-size checks covered traffic-light clearance, Boards, Account/appearance, Share, Export, admin, note creation/editing/selection, populated Comments, Backspace safety, Escape/focus restoration and saved content after restart. Final rebuilt full-size Light/Dark and save-details captures are linked in the gallery. macOS's purple screen-sharing indicator occupies the reserved traffic-light area in some captures.

## Verification

- Full browser suite: **301 passed, 3 intentional skips, no failures or flakes**. Skips are two opt-in README screenshot cases and WebKit's Chromium-only performance measurement.
- **125 unit tests** across nine files; full workspace typecheck; `git diff --check`.
- Full production build including the macOS `.app` and `.dmg`; isolated native QA builds.
- Targeted layout regressions retain meaningful alignment, scrolling, sticky-header paint, long metadata, floating-control collision, touch Comments and keyboard/focus checks. Existing behavior and permission tests remain in the full suite.
- Reproduce browser verification from the repository root: `pnpm --filter web exec playwright test --workers=4`; unit checks: `pnpm test`; types: `pnpm typecheck`; production artifacts: `pnpm build`.

## Evidence provenance

`before/`, `before-populated/`, `before-panels/` and `before-extra/` come from the preserved previous native web build, displayed with isolated local fixtures. They are historical comparison images, not a claim that the old binary exactly matches every pre-task source file. `before-entry/` restores the saved pre-task entry CSS on current content and returns the invitation introduction to its old sibling position; these are explicitly reconstructed layout reproductions. RV-04's before image temporarily restores the old optional-toast visibility rule, as recorded in its JSON evidence. `before-findings/` preserves actual first-round error images. Earlier review images remain available and are marked superseded in the matrix/gallery.

Only local QA data and generated build artifacts were used. This task changes no server API, schema, permission rule, production deployment, or production data.

Rebuild the local gallery/matrix with `python3 docs/qa/visual-polish/scripts/gallery.py`. The reusable capture scripts in `scripts/` document their local QA ports and fixture inputs; run from the repository root. Gallery filters, image loading, enlargement, arrow navigation, Escape and narrow layout passed at 1440/360px; see [gallery verification](gallery-verification.json).
