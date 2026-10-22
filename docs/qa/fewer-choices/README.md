# Fewer equal-weight choices

Item 6 of the Warm Den critique backlog. Reviewed with the Impeccable distill guidance and Emil design-engineering principles against `apps/web/DESIGN.md`.

| Before | After | Why |
| --- | --- | --- |
| Equal-weight creation tools and twelve gold phone tiles | Note, To-do and Board lead; Note alone has the accent; occasional tools use a quiet second tier | Common tasks have a clear starting point while every tool stays available |
| A board selection exposes colours, Open, Rename, eight icons and actions at once | Five contextual actions plus a separate Done; Colour and board icons open focused sheets | Keeps the board visible and gives every target at least 44px |
| Independent permission controls for username and link invitations | One Invitation permission control for either method | A single, explicit choice applies to the invitation being created |
| Outlined primary Add cards around a second icon tile | Borderless 64px leading tools and 44px secondary rows, all visible | Keeps the hierarchy while recovering board space without another tap |
| Palettes spread eight small choices across a full-width sheet | Centred 228px four-by-two grid with 48px targets | Groups the visual choices without shrinking their dots or icons |
| Share gives empty lists, settings, headings and copy the same flat gap | 16px section gaps, 8px within sections, populated access lists only | Spacing communicates relationships; empty lists reserve no space |
| Share repeats generic privacy and checkbox explanations | Shorter task copy, explicit new-invitation scope, conditional access consequences | Removes repetition while retaining sign-in, inheritance and expiry information |
| Create link stays primary while a username is being entered | Invite becomes primary when a username is present | Keeps one primary action aligned with the current task |

Design pass: checked both themes on desktop and phone for hierarchy, spacing, alignment, accent use and target size. Corrected Safari's native-select height, hid the sticker launcher while selection actions occupy its space, and added Done to the phone More sheet. No card typography, padding, measurements or canvas transforms changed.

Screenshots are captured with temporary Playwright specs (removed before commit). `desktop-*-tools` shows the creation rail; `phone-*-selection` shows the board selection dock; `phone-*-colour` confirms the actual green board colour is selected. The other images show Add, More, board icons and the shared invitation permission.

Integration with main `6152b6bf` (#69 and #70): resolved overlaps in Add, More and mobile styles while retaining immediate Add reopening, explicit sheet grips, cancellation and focus return. Added the shared grip to the new Colour and Board icon sheets, which were not covered by the upstream popover class list. The compact action dock and single invitation permission remain intact.

Validation after integration: typecheck and 312 unit tests pass. The focused Chromium, WebKit, iPhone and Pixel matrix passed 188 tests with 2 intentional skips and no retries. It includes six new phone regressions for grip cancellation, dismissal and focus return on Colour, Board icon and More, plus the recent Fetch, camera, reduced-motion and rapid Add checks. Canvas pan/zoom remain at 16.7–16.8ms p95 with a 13MB JS heap. Performance tests and budgets are unchanged. All twelve phone screenshots were refreshed after integration.

Follow-up design review: independent Impeccable and Emil assessments agreed on removing redundant Add containers, tightening palette spacing and grouping Share. The user chose compact, visible tools and updates to all four panels. Add now measures about 426px instead of 473px; Colour and Board icon measure 193px instead of 237px. Every target remains at least 44px. Phone permission uses a full-width select below its label; both layouts have 16px gutters. Existing members and links are grouped separately from new invitations. The inherited-access explanation waits for loaded access data rather than flashing while the owner is unknown. The private edit-invitation sheet now measures about 486px instead of the previous 565px; inherited/legacy-access explanations remain conditional. Placeholder colour comes from the existing muted-text token.

Design pass: inspected the changed dark/light Add, Colour, Board icon and desktop/phone Share captures, corrected loading-state captures, the inherited-access flash and the Share grip/header spacing, then confirmed the final renders. Safari uses an explicit select height (36px desktop / 44px touch). Temporary screenshot specs are removed before commit; existing creation/selection/More captures remain valid.

Refinement validation: `pnpm typecheck` and all 312 unit tests pass. The desktop/Safari/iPhone/Pixel matrix finished with 172 passing cases and one intentional skip; one existing Pixel toast case missed its initial card-selection tap. The focused recheck passed all eight dark/light and normal/reduced-motion combinations on iPhone and Pixel. All panel regressions, sharing/access cases and sheet-gesture checks passed. New geometry assertions wait for entrance motion to finish before measuring. No test budget or unrelated fixture was changed.
