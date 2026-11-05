---
version: 1
slug: "profile-photos"
primary_target: "apps/web/src/ui/AvatarEditor.tsx"
related_targets: ["apps/web/src/ui/avatar.css", "apps/web/src/ui/Avatar.tsx", "apps/web/src/ui/AccountMenu.tsx"]
---

# Profile photos

Mode: Operate. Code-led local refinement of DoggyNote's Warm Den system. The user's Telegram screenshots establish the crop and avatar interaction; Milanote is a secondary account-layout reference. No replacement visual world or generated comp.

## Direction contract

THESIS: Frame a profile photo by moving a crop over a stationary, fully visible image, and access photo actions directly from a balanced account identity header.

OWN-WORLD: Keep system typography, warm light/dark tokens, restrained amber primary actions, official Phosphor icons and the existing compact account popover/phone sheet.

STORY: Account → avatar camera → Add/Change photo → move/resize selection → Save → return to Account with the saved photo and avatar focus. Cancel preserves the previous picture. Remove returns to initials; failures preserve the previous state and offer retry.

FIRST VIEWPORT: A 56px avatar and vertically centred identity stack form one row: 15px semibold display name above muted 13px `@username`, with a 4px text gap. Empty display names fall back to the username. The row retains 16px padding/gap and one separator before account actions; Edit profile is the first action. The compact desktop popover is 280px wide. No loose Add/Change/Remove links. The avatar opens a small anchored photo menu, including on phones, with camera feedback only on mouse hover, including for empty photos. Focus and open-menu states do not reveal the camera; touch can still tap the labelled avatar.

FORM: The entire oriented source fits in a bounded preview with clearance for four outward-facing 44px corner targets. Initial crop and Reset use a centred 80% square. Drag within the selection moves square and circle together; outside dragging does nothing. Corner resize anchors the opposite corner within source bounds, retaining 25–100% crop size. Spreading fingers enlarges the selection and two-finger movement translates it. Arrow keys move in their indicated direction; Shift increases the step. Handle keys resize. The photograph never pans, zooms or automatically reframes. Each painted corner mark stays inside its disjoint 44px target. Below 44px crop size, a labelled 44px Move crop grip with a leader offers a separate disjoint movement target; proportional guide glyphs do not cross. The stage keeps a 224px minimum where viewport width permits. A subtle checkerboard behind source bounds identifies transparency without entering the exported image. Viewport changes only reproject source coordinates. Instruction: “Drag the circle to position it. Drag a corner to resize.”

QUALITY BAR: Direct manipulation must match pointer direction with no clipped-delta dead zone. Crop/output pixels agree. All four handles remain nonoverlapping and 44px, including panoramic/tiny selections, without automatic preview zoom. Square corners and circular guides stay visible together over light, dark and transparent sources. No board gesture leaks, obscured footer, lost crop on retry, inaccessible focus or nested phone sheets. Escape closes photo options before Account; Tab exits options to Edit profile and Shift+Tab to the avatar. Picker cancellation retains Account. Opening the editor immediately focuses Close photo editor. Both themes support desktop, tablet, 320px phone and short windows.

BOUNDARIES: Existing 512px transparent PNG export, source/upload limits, authenticated API, storage and privacy rules stay unchanged. No camera capture, rotation, filters, shape switch, public profile photos, schema changes or deployment. Browser automation only; native walkthrough remains out of scope by user direction.

FINISH: First critique and correction batch, recapture, fresh independent finish review, documentation check, typecheck/unit/build/full browser suite. Retain results and baseline failures without claiming a green full suite when it is not.

## Evidence

`docs/qa/avatars/stationary-round-1/` contains the first revision captures; `stationary-final/` contains the final corrected evidence. Earlier `round-1/`, `round-2/` and `corner-crop/` represent superseded interaction models and remain historical QA evidence only.
