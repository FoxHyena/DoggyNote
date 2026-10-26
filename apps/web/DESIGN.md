---
name: DoggyNote
description: A cosy, dog-themed infinite canvas for a small pack of friends.
colors:
  den-floor: "#1c1b1a"
  den-shelf: "#242220"
  den-card: "#2c2a27"
  den-card-hover: "#34312d"
  den-border: "#3d3934"
  cream-fur: "#ece7e1"
  muzzle-grey: "#a69d93"
  retriever-gold: "#e8a849"
  collar-coral: "#f08a7b"
  oat-biscuit: "#f3efe9"
  milk-bowl: "#fbf9f6"
  paper-white: "#ffffff"
  oat-hover: "#f7f3ee"
  oat-border: "#ddd5ca"
  oat-dot: "#d3cabe"
  wet-nose-brown: "#2a2521"
  paw-pad-brown: "#6b6158"
  toffee-retriever: "#9a5f0c"
  toffee-glow: "#b06c10"
  scolded-red: "#a8352a"
  card-gold-den: "#dcbd62"
  card-collar-den: "#d9765f"
  card-ball-den: "#86b89f"
  card-sky-den: "#7fa7d1"
  card-lilac-den: "#a99bd6"
  card-peach-den: "#e6a87c"
  card-gold-day: "#f4dc8f"
  card-collar-day: "#f2b2a2"
  card-ball-day: "#b9dcc9"
  card-sky-day: "#bcd4ee"
  card-lilac-day: "#d6cdf0"
  card-peach-day: "#f6cfb1"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.15
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  2xl: "14px"
  3xl: "16px"
  tray: "18px"
  pill: "999px"
spacing:
  2xs: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  2xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.retriever-gold}"
    textColor: "{colors.den-floor}"
    rounded: "{rounded.md}"
    padding: "9px 14px"
  button-primary-disabled:
    backgroundColor: "{colors.den-card-hover}"
    textColor: "{colors.muzzle-grey}"
    rounded: "{rounded.md}"
    padding: "9px 14px"
  icon-button:
    textColor: "{colors.muzzle-grey}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 8px"
  icon-button-hover:
    backgroundColor: "{colors.den-card-hover}"
    textColor: "{colors.cream-fur}"
    rounded: "{rounded.md}"
  tool:
    textColor: "{colors.muzzle-grey}"
    typography: "{typography.micro}"
    rounded: "{rounded.lg}"
    height: "48px"
    padding: "7px 2px 6px"
  tool-active:
    backgroundColor: "{colors.den-card-hover}"
    textColor: "{colors.retriever-gold}"
    rounded: "{rounded.lg}"
  input:
    backgroundColor: "{colors.den-floor}"
    textColor: "{colors.cream-fur}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "9px 12px"
  card-note:
    backgroundColor: "{colors.den-card}"
    textColor: "{colors.cream-fur}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
  board-tile:
    rounded: "{rounded.2xl}"
    size: "60px"
  label-chip:
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  menu:
    backgroundColor: "{colors.den-shelf}"
    rounded: "{rounded.lg}"
    padding: "4px"
  menu-item:
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "8px 12px"
  selection-bar:
    backgroundColor: "{colors.den-shelf}"
    rounded: "{rounded.xl}"
    padding: "8px"
  dialog:
    backgroundColor: "{colors.den-shelf}"
    textColor: "{colors.cream-fur}"
    rounded: "{rounded.2xl}"
    padding: "14px 16px 16px"
  toast:
    backgroundColor: "{colors.den-shelf}"
    textColor: "{colors.cream-fur}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
---

# Design System: DoggyNote

> **Source of truth.** Colours live in `packages/theme/src/tokens.ts` and reach components only as `var(--dn-*)` custom properties. This file mirrors those tokens for agents and design tools. Change the tokens there, never here alone, and keep `theme.test.ts` green.

## Overview

**Creative North Star: "The Warm Den"**

DoggyNote is a lamp-lit room where your things are spread out on the floor. The canvas is the floor: warm, dark, dotted, and quiet. The cards are what you brought in. The chrome around them is furniture you stop noticing, set in the same warm browns as the room. One golden light, Retriever Gold, marks where your attention is: the selected card, the active tool, the one button that moves you forward.

The den is dark by default and has a daytime twin in oat and milk tones. Both are tuned together. Every colour has a value in each theme, and contrast is enforced by test, not taste. Density is calm rather than sparse. Controls are compact (13px labels, 32px icon buttons), so the board gets the space.

Personality lives in small, specific dog moments rather than decoration. A board tile tilts when you hover it. The Phosphor paw login logo leans at an angle. A dragged tool's ghost is slightly askew. Stickers wear a white die-cut border. The pan cursor is a paw. Everything else is plain. The den rejects the cool-grey, blue-button sterility of corporate SaaS, and it rejects frosted glass, neon glows and purple-blue gradients.

**Key Characteristics:**
- Warm brown neutrals throughout; no cool greys anywhere.
- One amber accent per theme, used sparingly for selection, focus and the primary action.
- Dark-first, with a fully tuned light twin.
- Flat canvas; only floating tools and lifted cards cast shadows.
- System font, small sizes, firm weights (600 for emphasis).
- Dog personality comes from motion, tilt and copy, never from ornament.

## Colors

A warm, low-chroma brown family lit by a single golden retriever amber, plus six soft card swatches named after the dog's world.

### Primary
- **Retriever Gold** (dark theme accent and selection): the den's only light source. It marks the selection outline, focus rings, the active tool's icon, the primary button, the sync-in-progress dot, the favourite star on stickers and the paw cursor. Text drawn on it is Den Floor.
- **Toffee Retriever** (light theme accent): the same golden retriever, darkened so white text on it passes 4.5:1. It carries the primary button and active tool in the daytime twin.
- **Toffee Glow** (light theme selection): a slightly brighter toffee used only for selection outlines and focus rings in light mode, tuned to 3:1 against the oat canvas.

### Neutral
- **Den Floor** (dark canvas): the infinite board's background, also the field inside inputs, and text on Retriever Gold.
- **Den Shelf** (dark panel): the top bar, toolbar, menus, dialogs, toasts and the selection bar. Everything that is furniture, not content.
- **Den Card** (dark card): the default note and to-do surface.
- **Den Card Hover**: hover fills on ghost buttons, menu items and tools; the resting background of the active tool and disabled primary.
- **Den Border**: hairlines between shelf and floor, card borders inside columns, and the canvas grid dots.
- **Cream Fur** (dark text) and **Muzzle Grey** (dark muted text): primary and secondary text. Muted text is the resting colour of every icon button and tool.
- **Collar Coral** (dark error text): inline field errors only.
- **Oat Biscuit**, **Milk Bowl**, **Paper White**, **Oat Hover**, **Oat Border**, **Oat Dot**: the light twin of floor, shelf, card, hover, border and grid dots.
- **Wet Nose Brown** and **Paw Pad Brown**: light theme text and muted text. **Scolded Red** is light theme error text.

### Card swatches
Six colours a person can give a note or column header, each with a background and a matched text colour per theme: **Gold**, **Collar**, **Ball**, **Sky**, **Lilac** and **Peach**, plus **None** (the plain card). Dark-theme swatches (`-den`) are muted mid-tones; light-theme swatches (`-day`) are pale pastels. Their text pairs live in `tokens.ts` and are not repeated here. Synced colour values always pass through `cardColor()` before reaching CSS.

The same family supplies the **diff** colours (added, changed, removed) shown when previewing an agent's proposal, and the seven **person** colours for collaborator cursors and presence. Both reuse the Ball, Sky, Collar, Lilac, Gold and Peach hues, so collaboration reads as part of the den rather than an overlay.

### Named Rules
**The One Lamp Rule.** Retriever Gold is the only accent. It appears where attention belongs (selection, focus, the single primary action, the active tool) and nowhere decorative. If a screen has two gold buttons, one of them is wrong.

**The Twin Rule.** No colour exists in one theme only. Every new token gets a dark and a light value in `tokens.ts` and passes `theme.test.ts`: 4.5:1 for text, 3:1 for the selection outline.

**The No Hex Rule.** Components never contain a hex value. They read `var(--dn-*)`. Canvas drawing code reads `surfaces[theme()]`.

## Typography

**Body Font:** the platform system font (-apple-system, BlinkMacSystemFont, with Inter and Segoe UI as fallbacks)
**Mono Font:** ui-monospace (SFMono-Regular, Menlo)

**Character:** one native sans at small, firm sizes. The type is meant to feel like part of the operating system, so the board's content and the dog copy carry the voice instead.

### Hierarchy
- **Headline** (700, 22px, 1.25): entry screens only, such as the login card heading.
- **Title** (600, 16px): dialog headings and the empty-board title.
- **Body** (400, 14px, 1.45): the default for the app and inside notes. Note headings scale relatively (h1 1.35em, h2 1.18em, h3 1.05em) so a coloured note keeps its proportions at any zoom.
- **Label** (400, 13px, 20px line): menu items, form labels, panel text.
- **Caption** (500, 12px): label chips, icon-button labels, sync status, keyboard hints.
- **Micro** (400, 11px, 1.15): the toolbar's labels under icons, tags, the sticker footer.
- **Mono** (400, 12px, 1.5): code inside notes (at 0.92em) and diagnostics.

### Named Rules
**The 600 Rule.** Emphasis is weight 600: the current breadcrumb, column titles, board titles, primary buttons. Reach for 700 only for the entry headline. Never use colour alone for emphasis.

**The Measured Card Rule.** Never change font size or padding inside a card for touch or any other mode. Card heights are measured and synced, so a size change on one device moves cards for everyone. Enlarge the targets outside the card instead.

## Layout

The desktop shell is a two-by-two grid: a 76px vertical toolbar on the left, a 48px top bar across the top, and the canvas filling the rest. The top bar sits above every floating panel so its menus are never covered. Floating UI (selection bar, sticker tray, panels, toasts) is positioned over the canvas rather than docked into the grid.

The canvas is a dotted infinite plane. The dots step with the camera (20px at rest) and fade as you zoom out. Cards are placed with `left`/`top`. Pan and zoom transform only the world layer. Below 35% zoom, cards stop being DOM and are drawn on one canvas.

Spacing runs on small steps: 2, 4, 6, 8, 12, 16 and 24px. Gaps inside controls are 4–8px, panel padding is 8–16px, and dialogs breathe at 14–16px.

**Phone layout** (max-width 599px, or a phone on its side): the toolbar becomes a bottom dock with a raised round amber add button. The selection bar docks to the bottom edge as a sheet with an 18px top radius. Panels become sheets over a scrim. Touch-only CSS keys off `html[data-input='touch']`, and every touch target gets a 44px hit area, invisible if necessary.

## Elevation & Depth

The den is flat where you work and lifted where you reach. Cards rest flat on the floor. In the dark theme they are separated by tone alone. In the light theme they get a hairline paper edge so white cards don't dissolve into oat. Anything that floats above the board (menus, the selection bar, dialogs, the sticker tray, the fetch palette) casts a soft, dark, diffuse shadow. A card being dragged lifts with a deep shadow and returns flat when dropped.

### Shadow Vocabulary
- **Paper edge** (`0 1px 2px rgb(60 40 20 / 0.12), 0 0 0 1px rgb(60 40 20 / 0.06)`): resting cards, light theme only.
- **Floating** (`0 8px 24px rgb(0 0 0 / 0.25)` to `0 8px 28px rgb(0 0 0 / 0.25)`): menus and the selection bar.
- **Lifted** (`0 14px 32px rgb(0 0 0 / 0.35)`): a card while dragging.
- **Modal** (`0 20px 50px` to `0 24px 60px rgb(0 0 0 / 0.25–0.35)`): the login card and the fetch palette.
- **Swatch ring** (`0 0 0 2px var(--dn-panel), 0 0 0 3.5px <colour>`): selected colour swatches, a gap ring rather than a shadow.
- **Sticker shadow** (`--dn-sticker-shadow`, hard and offset): placed stickers, like a vinyl decal on the floor.

### Named Rules
**The Flat Floor Rule.** Content on the canvas never casts a shadow at rest. Shadows mean "this is floating above the board" or "you're holding this".

## Shapes

Gently rounded and never pill-shaped except for chips. Radius grows with the object's size and how far it floats: cards and menu rows 6px, buttons and inputs 8px, menus and tools 10px, the selection bar and sticker tiles 12px, dialogs and board tiles 14px, the login card 16px, the sticker tray and phone sheets 18px. Label chips, avatars and status dots are fully round.

Borders are 1px hairlines in the border token. Selection and focus are a 2px outline in the selection colour, offset 2px from the edge.

## Components

### Buttons
Soft and quiet. Buttons stay out of the way until they are the thing to press.
- **Shape:** gently rounded (8px).
- **Primary:** Retriever Gold fill with Den Floor text, weight 600, 9px × 14px padding. On mouse hover it brightens slightly (`brightness(1.06)`). One per view.
- **Disabled primary:** stays readable. It becomes a quiet outlined card (hover fill, muted text, 1px inset border) rather than a faded gold.
- **Icon button (ghost):** transparent with muted icon, at least 32px square. On hover it takes the card-hover fill and full text colour. In the "on" state the icon turns gold.
- Hover styles apply only under `html[data-input="mouse"]`, so touch never shows sticky hover.

### Toolbar tools
A vertical stack of 48px tiles, each an icon above an 11px label. They rest in muted text, fill on hover, press down to 95% scale, and when active show a card-hover fill with a gold icon. Dragging a tool out shows a ghost card tilted −2°.

### Cards
- **Corner style:** 6px. Board cards are transparent at 12px, showing a 60px rounded tile (14px) in the board's colour.
- **Background:** Den Card, or the chosen swatch with its paired text.
- **Selected / editing:** 2px selection outline, 2px offset. Only the card being edited mounts an editor.
- **In a column:** 1px border and no shadow. The column has a shelf background and a coloured header.
- **Board tile hover:** lifts 2px and tilts −3° with a small overshoot. This is a dog moment (see Motion).

### Conversations
One note-style board object holds the thread, using the existing card surface, swatches and 6px corners. The title leads and can be renamed inline; provider and source controls stay secondary. Shared card geometry stays stable while answers stream. The active card contains the full thread and composer; inactive cards show the latest cached exchange and an explicit continuation control. Full history loads after deliberate activation, keeping passive previews free of transcript requests.

Context inspection replaces the card body, retaining the header and controls without a backdrop. Opening it refreshes the direct sources and their captured text. Back to thread keeps a neutral fill while inspection is open; source versions sit inline, and explanatory help follows the sources. A context-change error opens inspection with an explicit Inspect updated context action. Earlier messages retain their own snapshots.

Compact exchange spacing keeps short-answer actions close to the answer, ahead of the collapsed Context used disclosure containing captured sources and provider usage. Healthy provider details sit in a separate collapsed disclosure in the history. Branching from a completed answer places an alternative beside the thread with its visible history and captured context. Saving an answer or selection creates an editable neighboring note with a connection and provenance link; following that link loads history, then focuses and outlines the specific exchange. Task output uses an editable draft before board review.

The header remains draggable while its controls act independently. Message text stays selectable, and history, previews and context scroll within the card without spilling into board navigation. Streaming follows the latest answer only while the reader stays near the end. A polite status region announces run-state changes rather than streamed tokens. Phone framing changes the local camera against the visible viewport, software keyboard and actual floating controls. Conversation buttons and provider controls retain 44px targets across input modes; typography, padding and shared dimensions do not change for touch. The composer uses 16px text in every mode. Browsers support reading and organization; sending through a local provider remains a Mac-app operation.

Prompt and question drafts survive reload in local storage scoped to the person, conversation and, for questions, request. Storage failures appear as alerts. A completed send clears only its submitted draft, preserving newer typing; delayed focus returns only while the conversation retains focus ownership.

When Codex requests clarification, a bounded question form appears in the thread and the composer yields room to it. Native suggestion selects start unselected; the person explicitly uses Send answer or stops the turn. Suggestion and answer fields disable during submission. New questions inherit conversation focus without taking it from another card; reopening a waiting note can focus its answer when the page body has focus. The footer identifies the waiting state and retains Stop; Stop also remains in the header during context inspection. Questions and replies remain in saved visible history. Closing retains the pending request within the app session; the passive note identifies the waiting state. Inputs stay at 16px with controls at least 44px tall, using the incumbent note surface in both themes. This form cannot grant shell, file or MCP permissions.

### Label chips
Pill-shaped, 12px weight 500, 1px × 8px padding, with each label's own background and a text colour picked for contrast. A faint inset edge in the text colour keeps pale labels visible on white cards.

### Inputs
Den Floor fill, 1px border, 8px radius, at least 44px tall, 14px text. Focus is a 2px selection outline with no offset. Errors appear as Collar Coral text beneath, or as a Collar swatch block for form-level errors.

### Menus and popovers
Shelf background, 1px border, 10px radius, floating shadow, 4px inner padding. Rows are at least 36px tall, 13px text, 6px radius, with a hover fill. Keyboard hints sit right-aligned in muted 12px. Right-clicking a card hides the selection bar while its menu offers edit (Rename for boards), duplicate, label, comment and bury actions; arrows move through the menu and Escape returns focus to the card. A location ping appears only when another live participant is present. Separators are 1px border lines inset 6px.

### Dialogs and sheets
Shelf background, 14px radius, at most 460px wide, over a 45% black backdrop. Headings are 16px. On phones, dialogs and panels become bottom sheets over the scrim token.

### Creation tools
Note, To-do and Board lead the desktop rail and phone Add sheet. Note is the single accented choice. Occasional tools sit in a quieter More tier; desktop tools keep click and drag creation. Phone Add uses one three-column catalogue of identical 44px inline icon-and-label buttons, with 4px row gaps and 8px column gaps. The first three tools use weight 600; Note alone has the primary button fill. Occasional tools remain visible on the same column grid, without a second heading or button grammar. Add and palette sheets use 16px gutters and a 44px header; their centred 96px-wide grip retains its 28px drag target while sharing the noninteractive space above the heading text.

### Sharing
One labelled Invitation permission control applies to new username invitations and links. Existing access and links retain their own permissions. View only is the default; Can edit exposes the account-creation option for links. Settings are labelled for new invitations; existing people and links form separate sections, shown only when populated. Use 16px between sections, 8px within sections and 4px from a heading to its explanation. The permission label and compact 128px native select share a row on desktop and phone. The select has balanced 12px text/chevron insets inside its border and one Phosphor caret; it is 36px tall on desktop and 44px on touch. Typing a username gives Invite the single primary emphasis. General privacy and redundant checkbox copy stay out of the creation flow; inherited access and invitation-expiry consequences remain explicit.

### Selection bar
A floating shelf pill (12px radius, floating shadow) centred above the selection, popping in over 140ms. It anchors to the selected item, including column members, with a 14px gap above, below or beside it. Obstacle-driven sliding is limited to 64px from viewport-clamped anchor positions; crowded boards permit neighboring overlap rather than distant placement. The selected content and column disclosure take priority. Labels popovers also avoid card content and the bar; crowded boards use the position covering the least content. The desktop bar holds swatches, board icons, item position locks, eligible alignment and list options. Card actions live in right-click; Open is available through double-click or Enter. Collapse uses the column header disclosure only. Selecting a member exposes no parent-column actions, and alignment requires any affected parent column to be explicitly selected. It wraps rather than scrolls on narrow windows. On phones, a compact dock shows Open (boards) or Edit, Colour, Labels, Bury and More. Only Open/Edit gets the accent fill; Done closes the selection separately. Colour and board icons open focused sheets with a centred four-by-two grid: 44px targets, 12px column gaps and 4px row gaps, preserving 32px colour dots and 24px icons. Leave 12px between the header row and the full target tile. Selected icons use the selection outline as well as a neutral fill; hover uses the fill alone. More holds Rename, board icons, locks, alignment, duplication, comments, connectors and list options when applicable. The selected colour always reflects the displayed card or board.

### Stickers
Image stickers with a white die-cut outline and a hard offset shadow, placed directly on the canvas. They are browsed in a rounded 18px tray with a 4-column grid of 12px-radius tiles.

### Icons
- All interface icons and dog artwork come from the official MIT-licensed `@phosphor-icons/core` SVG pack, pinned in the web package. `ui/iconAssets.ts` statically imports the curated set; `Icon` owns their native 256×256 viewBox, `currentColor`, and decorative semantics. Never redraw paths, override strokes, or put a complete SVG inside another SVG.
- Regular is the control weight. Fill is reserved for the brand paw and filled favorite/pinned states. Existing sizes, labels, hit areas, and theme colors remain authoritative.
- Account uses UserCircle. Bury/Buried bones uses Archive with its label; the selectable board bone remains Bone, and permanent deletion uses Trash. Dog replaces the former custom illustration; loading pulses the whole glyph and stays static with reduced motion.
- Stored board-icon IDs remain `paw`, `bone`, `ball`, `collar`, `kennel`, `bowl`, `star`, `heart`. Their pack equivalents are PawPrint, Bone, TennisBall, Tag (a collar tag), HouseLine, BowlFood, Star, Heart. Unknown IDs render PawPrint.
- The favicon, installed app icons, paw cursor, and empty-state paw all derive from the same upstream filled PawPrint. Regenerate with `pnpm --filter web icons`; the script also regenerates desktop icon formats.
- Canvas connections, transform rings, progress graphics, collaborator pointer/ping geometry, third-party marks, and user stickers retain their own geometry. The upstream notice ships at `/licenses/phosphor-icons.txt`.

### Motion
- **Standard:** 120ms for hover colour and background; 140–160ms ease-out for pop-ins, toasts and menus; 70ms ease-out for snap-to-grid glides.
- **Fetch:** no entrance animation. The frequent keyboard command is visible and focused immediately.
- **Phone sheets:** 200–240ms on `cubic-bezier(0.22, 1, 0.36, 1)`, a fast settle with no overshoot.
- **Sheet gestures:** only the explicit grip owns a pull; the body keeps native scrolling. Follow the active pointer directly; cancellation restores the sheet and re-grabbing interrupts dismissal. Release settles over 180ms ease-out, or immediately under reduced motion.
- **Toasts:** preserve horizontal centering throughout entry. Transform/opacity transitions take 160ms on desktop and 200ms on phones; message replacement and dismissal remain immediate.
- **Dog moment overshoot:** `cubic-bezier(0.3, 1.6, 0.6, 1)` at about 140ms, reserved for playful pickups (board tile hover, the phone dock's amber add button).
- **Bury sink:** a buried card's copy falls into Buried bones over 380ms (`cubic-bezier(0.5, 0, 0.75, 0)`, shrinking and tilting −12°), then the icon bumps. Only the copy animates, never the canvas card.
- Everything respects `prefers-reduced-motion`, including JavaScript camera moves. Those apply their target immediately and retain completion/focus behavior; enabling reduced motion during a glide finishes it at its target.

## Do's and Don'ts

### Do:
- **Do** take every colour from `var(--dn-*)`, and add new ones to `tokens.ts` with both a dark and a light value.
- **Do** keep Retriever Gold for selection, focus, the active tool and a single primary action per view.
- **Do** use weight 600 for emphasis and keep app chrome at 11–14px.
- **Do** keep the canvas flat. Give shadows only to floating UI and the card being dragged.
- **Do** put dog personality in copy (`COPY` in `packages/theme/src/copy.ts`), small tilts, the paw cursor and stickers.
- **Do** gate hover styles behind `html[data-input="mouse"]`, and give touch targets 44px hit areas outside the card.
- **Do** use calm ease-out at 120–200ms for UI, and save overshoot for dog moments.

### Don't:
- **Don't** hard-code hex values in components, or add a colour that exists in one theme only.
- **Don't** introduce cool greys, blue primary buttons or other corporate SaaS sterility.
- **Don't** use frosted glass, neon glows, or purple-blue gradients.
- **Don't** add a second accent colour or put gold on decoration.
- **Don't** put springy overshoot on functional transitions such as sheets, menus, toasts or the docked selection bar. Those use `cubic-bezier(0.22, 1, 0.36, 1)`.
- **Don't** change text size or padding inside cards for any input mode. Heights are measured and synced.
- **Don't** give cards a per-card `transform`, or shadows at rest.
