---
version: 1
slug: "profile-names"
primary_target: "apps/web/src/ui/ProfileEditor.tsx"
related_targets: ["apps/web/src/ui/profile.css", "apps/web/src/ui/AccountMenu.tsx", "apps/web/src/ui/Signup.tsx"]
---

# Profile names

Mode: Operate. A local extension of DoggyNote's incumbent Warm Den identity controls, desktop dialog and phone sheet. Existing typography, light/dark tokens, Phosphor icons and primary-action grammar remain authoritative.

## Direction contract

THESIS: Let people choose the name collaborators see while retaining a stable username for sign-in and invitations.

FIRST VIEWPORT: Account keeps its 280px desktop popover, 56px avatar, 16px row padding/gap and separator. A vertically centred stack shows a 15px semibold display name over a muted 13px `@username`, separated by 4px; long text wraps. Edit profile is the first account action. Photo-menu Tab proceeds to Edit profile; Shift+Tab returns to the avatar. Photo editing retains its existing crop, save and focus behavior.

STORY: Account → Edit profile → change Display name → Save → Account with the acknowledged name and focus on Edit profile. Cancel preserves the previous name. The optional name is trimmed, single-line, nonunique and limited to 64 characters, including spaces and emoji. Empty clears it and uses the username as the visible fallback. Username is read-only in this flow.

FORM: Use the existing desktop dialog and phone sheet over the scrim token. Display name starts focused and shows “This is the name other people see. Leave it empty to use your username.” beneath it. Username appears below as a muted read-only `@username`. Inputs use 16px text, existing floor/border/focus tokens, 8px corners and at least 44px height. Close, Cancel and Save have 44px targets. Save is the single primary action; unchanged values leave it disabled. Fields scroll within the editor while the action row stays accessible.

QUALITY BAR: Focus remains within the editor and closing returns it to Account's Edit profile action. Save waits for acknowledgement before updating the local profile cache and closing. Inline errors preserve the draft for retry. While saving, editing, actions and dismissal are disabled. Existing desktop and phone framing must support long names, emoji, both themes, 320px width and the software keyboard.

IDENTITY: Current names propagate through presence, cursors, carets, pings, follow controls, sharing, Shared with me attribution, administration and comments. Historical comments resolve the current name by author ID through the authorized profiles sidecar; stored author snapshots remain unchanged and serve as fallback. Profiles are limited to authorized comment authors, rather than exposed through a public directory. Both invitation signup flows offer the same optional display name and username fallback.

BOUNDARIES: No username editing, public profile cards, bios or phone fields. Existing avatar editor and photo handling remain unchanged. Deployment is outside this surface contract.

## Evidence

`docs/qa/profiles/` contains nine validated desktop/phone, light/dark and 320px captures. The independent finish review returned ship with no material source, UI or API findings. Typecheck and all 646 unit/integration tests passed. The final focused browser run passed all 78 cases without retries, covering profiles, account and board signup, photos, keyboard/theme controls, phones and the desktop bearer-token flow. The broader CI run was not green; see `docs/qa/profiles/README.md` and its full-suite summary for the results and limitations.
