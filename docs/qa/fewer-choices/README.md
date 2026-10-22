# Fewer equal-weight choices

Item 6 of the Warm Den critique backlog. Reviewed with the Impeccable distill guidance and Emil design-engineering principles against `apps/web/DESIGN.md`.

| Before | After | Why |
| --- | --- | --- |
| Equal-weight creation tools and twelve gold phone tiles | Note, To-do and Board lead; Note alone has the accent; occasional tools use a quiet second tier | Common tasks have a clear starting point while every tool stays available |
| A board selection exposes colours, Open, Rename, eight icons and actions at once | Five contextual actions plus a separate Done; Colour and board icons open focused sheets | Keeps the board visible and gives every target at least 44px |
| Independent permission controls for username and link invitations | One Invitation permission control for either method | A single, explicit choice applies to the invitation being created |

Design pass: checked both themes on desktop and phone for hierarchy, spacing, alignment, accent use and target size. Corrected Safari's native-select height, hid the sticker launcher while selection actions occupy its space, and added Done to the phone More sheet. No card typography, padding, measurements or canvas transforms changed.

Screenshots are captured with temporary Playwright specs (removed before commit). `desktop-*-tools` shows the creation rail; `phone-*-selection` shows the board selection dock; `phone-*-colour` confirms the actual green board colour is selected. The other images show Add, More, board icons and the shared invitation permission.

Integration with main `6152b6bf` (#69 and #70): resolved overlaps in Add, More and mobile styles while retaining immediate Add reopening, explicit sheet grips, cancellation and focus return. Added the shared grip to the new Colour and Board icon sheets, which were not covered by the upstream popover class list. The compact action dock and single invitation permission remain intact.

Validation after integration: typecheck and 312 unit tests pass. The focused Chromium, WebKit, iPhone and Pixel matrix passed 188 tests with 2 intentional skips and no retries. It includes six new phone regressions for grip cancellation, dismissal and focus return on Colour, Board icon and More, plus the recent Fetch, camera, reduced-motion and rapid Add checks. Canvas pan/zoom remain at 16.7–16.8ms p95 with a 13MB JS heap. Performance tests and budgets are unchanged. All twelve phone screenshots were refreshed after integration.
