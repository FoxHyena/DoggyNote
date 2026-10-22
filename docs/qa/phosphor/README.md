# Phosphor migration verification

The app uses pinned `@phosphor-icons/core` 2.1.1 assets. Controls use Regular; the paw and favorite/pinned states use Fill. All eight saved board-icon IDs retain their values and picker order.

Visual checks used isolated local fixture data, the production web build, desktop at 1440×900 and iPhone 15 Pro emulation at 393×659 CSS pixels. Phone images include the device's 3× pixel density. Selection-sheet animations finished before capture.

- [Light icon sheet](icon-sheet-light.png) and [dark icon sheet](icon-sheet-dark.png): representative controls and all board symbols at 18, 20, 22 and 24px.
- [Desktop light](desktop-light.png) and [desktop dark](desktop-dark.png): toolbar, account, board picker, and canvas controls.
- [Phone light](phone-light.png) and [phone dark](phone-dark.png): board picker and labeled selection actions.
- [Login](login-dark.png), [loading](loading-dark.png), and [unavailable board](unavailable-dark.png): Phosphor paw and Dog artwork.
- The loader's computed animation is `none` with reduced motion. The cursor retains its 13×13 hotspot and native `grab` fallback. PWA maskable and desktop icon PNGs were inspected for padding and clipping.

`pnpm --filter web icons` regenerates the favicon, PWA and desktop formats, and cursor from the official filled PawPrint and theme tokens. The upstream MIT notice ships in `apps/web/public/licenses/phosphor-icons.txt`.

Verification includes workspace typecheck, the production build, 312 unit/server tests, and browser tests for persisted board choices, malformed-ID fallback, repeated icon instances, inherited color, offline rendering, navigation, touch layout, selection/alignment, locks, stickers, sharing, and burial/undo.

The production bundle contains the 74 explicitly selected SVG assets; five unrelated sentinel glyphs are absent. There is no runtime whole-pack loader or remote icon request. See [bundle check](bundle-check.json).

The Impeccable detector reports the same 72 existing CSS findings as the pre-migration assessment: 2 Markdown quote-border warnings and 70 token/motion advisories. There are no icon-specific findings.

The focused browser runs passed 155 regression checks and an earlier 73 navigation/theme/burial checks (some overlap). The separately rerun WebKit 500-sticker performance test fails its relative jitter threshold on both this change and an untouched `HEAD` baseline: p50 10ms, p95 14ms, versus the relative 12.5ms limit. Both remain below its absolute 33.4ms budget. No performance-test thresholds were changed.
