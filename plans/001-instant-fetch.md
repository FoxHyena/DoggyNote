# 001 — Open Fetch immediately

- **Status**: IMPLEMENTED — focused review approved
- **Commit**: c076eee2
- **Estimated scope**: 1 stylesheet plus shared desktop regressions; small CSS change
- **Severity**: HIGH
- **Category**: Purpose/frequency

## Problem

See confirmed finding 1 in `motion-audit.md`. Current source is `apps/web/src/ui/canvas-entry.css`:

```css
  animation: pop-fetch 140ms ease-out;
```

## Target and ordered implementation

Set the `.fetch` rule to `animation: none`. Preserve the shared `pop-fetch` keyframe because `.update-toast` still consumes it. Do not change the backdrop, input, search, result activation or cleanup logic. Add a desktop regression that repeatedly opens Fetch with the shortcut, checks first-frame opacity 1 and identity transform with no active entrance, types and selects a result, dismisses during repeated use, and verifies focus returns to the originating control.

## Repo conventions

Follow `apps/web/DESIGN.md`: 140–160ms ordinary controls, 200–240ms phone entry, the documented sheet curve, shared theme variables, no motion library. New regressions live in `apps/web/e2e/motion.spec.ts` and `apps/web/e2e/mobile-motion.spec.ts`; share only behavior helpers under `e2e/motion-helpers.ts` if needed.

## Boundaries

Use existing SolidJS and browser APIs; add no dependencies. Preserve focus restoration, Escape handling, synchronous mobile editor focus, card measurements and the world-only camera transform. Preserve documented dog overshoot, burial-copy motion and ordinary sheet entry timing. Do not change server APIs, schemas or permissions.

## Verification

Run the new motion and mobile-motion Playwright cases in WebKit and Chromium, both themes, and normal/reduced motion. Inspect real input paths and recorded samples, not only computed declarations. Run workspace typecheck and unit tests, then full browser suite and headed canvas/sticker performance checks once integrated. See `motion-audit.md` for before captures. Check affected native and physical-phone interactions when hardware is available; record any unavailable check explicitly.

## Done when

The selected behavior meets the target above, its regressions pass in both engines, and the motion review verdict is Approve. Hardware verification gaps remain visible in the integration report.
