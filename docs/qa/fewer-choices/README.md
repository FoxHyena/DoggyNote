# Fewer equal-weight choices

Item 6 of the Warm Den critique backlog. Reviewed with the Impeccable distill guidance and Emil design-engineering principles against `apps/web/DESIGN.md`.

| Before | After | Why |
| --- | --- | --- |
| Equal-weight creation tools and twelve gold phone tiles | Note, To-do and Board lead; Note alone has the accent; occasional tools use a quiet second tier | Common tasks have a clear starting point while every tool stays available |
| A board selection exposes colours, Open, Rename, eight icons and actions at once | Five contextual actions plus a separate Done; Colour and board icons open focused sheets | Keeps the board visible and gives every target at least 44px |
| Independent permission controls for username and link invitations | One Invitation permission control for either method | A single, explicit choice applies to the invitation being created |

Design pass: checked both themes on desktop and phone for hierarchy, spacing, alignment, accent use and target size. Corrected Safari's native-select height, hid the sticker launcher while selection actions occupy its space, and added Done to the phone More sheet. No card typography, padding, measurements or canvas transforms changed.

Screenshots are captured with temporary Playwright specs (removed before commit). `desktop-*-tools` shows the creation rail; `phone-*-selection` shows the board selection dock; `phone-*-colour` confirms the actual green board colour is selected. The other images show Add, More, board icons and the shared invitation permission.

Performance control: the unchanged `origin/main` (`6ddbe4c5`) reproduces the same WebKit `perf-stickers` relative-timing failure (13ms p95 against a 12.5ms threshold) in a temporary copy on separate ports. The main canvas perf spec remains green at 16.7–16.8ms p95. The performance tests and their budgets were not changed.

Validation: typecheck and 312 unit tests pass. The broad e2e scan passed 905 tests; updated layout assumptions and the longer persisted-icon flow were then checked in a 251-pass focused run across Chromium, WebKit, iPhone, Pixel and iPad. The three remaining functional failures in that focused run (two accumulated-fixture pagination checks and a location-ping timing check) passed on a clean database in both desktop engines. All new and updated UI specs pass.
