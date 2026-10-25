# 005 — Keep toast entries centered

- **Status**: IMPLEMENTED — focused review approved
- **Commit**: c076eee2
- **Estimated scope**: 2 stylesheets plus shared desktop/mobile regressions; transform/opacity entry correction
- **Severity**: MEDIUM
- **Category**: Spatial consistency

## Problem

See confirmed finding 5 in `motion-audit.md`. Current source is `apps/web/src/index.css`:

```css
  animation: slide-in 160ms ease-out;
```

## Target and ordered implementation

Replace the desktop toast keyframe with transform and opacity CSS transitions at 160ms on the documented cubic-bezier(.22,1,.36,1). Use @starting-style opacity 0 and translate(-50%, 8px), ending at the existing translateX(-50%). Mobile keeps its top position and 200ms duration with starting translate(-50%, -10px), replacing its old toast-down keyframe. Keep immediate dismissal, live text replacement and Undo behavior. Older browsers without @starting-style show the toast immediately. Honor the existing reduced-motion policy and explicitly suppress entry displacement there. Regress short/long and repeated notification text by sampling the actual toast center through entry; verify Undo remains clickable and restoring the buried card works.

## Repo conventions

Follow `apps/web/DESIGN.md`: 140–160ms ordinary controls, 200–240ms phone entry, the documented sheet curve, shared theme variables, no motion library. New regressions live in `apps/web/e2e/motion.spec.ts` and `apps/web/e2e/mobile-motion.spec.ts`; share only behavior helpers under `e2e/motion-helpers.ts` if needed.

## Boundaries

Use existing SolidJS and browser APIs; add no dependencies. Preserve focus restoration, Escape handling, synchronous mobile editor focus, card measurements and the world-only camera transform. Preserve documented dog overshoot, burial-copy motion and ordinary sheet entry timing. Do not change server APIs, schemas or permissions.

## Verification

Run the new motion and mobile-motion Playwright cases in WebKit and Chromium, both themes, and normal/reduced motion. Inspect real input paths and recorded samples, not only computed declarations. Run workspace typecheck and unit tests, then full browser suite and headed canvas/sticker performance checks once integrated. See `motion-audit.md` for before captures. Check affected native and physical-phone interactions when hardware is available; record any unavailable check explicitly.

## Done when

The selected behavior meets the target above, its regressions pass in both engines, and the motion review verdict is Approve. Hardware verification gaps remain visible in the integration report.
