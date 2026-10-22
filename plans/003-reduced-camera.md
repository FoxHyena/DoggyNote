# 003 — Honor reduced motion in camera animation

- **Status**: IMPLEMENTED — focused review approved
- **Commit**: c076eee2
- **Estimated scope**: 1 canvas module plus shared desktop/mobile regressions; preserve camera geometry
- **Severity**: MEDIUM
- **Category**: Accessibility

## Problem

See confirmed finding 3 in `motion-audit.md`. Current source is `apps/web/src/canvas/Canvas.tsx`:

```tsx
  cancelAnimationFrame(anim)
  stopMomentum()
  const from = camera()
```

## Target and ordered implementation

At `animateCamera` entry use `cancelCameraAnimation()` and `stopMomentum()`. Create a per-call reduced-motion MediaQueryList. A shared completion function clears the frame id, sets the exact target camera and invokes the supplied callback once. Invoke it synchronously if reduced motion matches or duration is nonpositive. Check the same query in each animation frame so a preference change during interpolation finishes at the target. Otherwise retain existing cubic interpolation, duration defaults and viewport-center geometry. Test zoom/fit and edit-framing focus under reduced motion plus a live preference change; observe no intermediate camera matrices in the reduced path.

## Repo conventions

Follow `apps/web/DESIGN.md`: 140–160ms ordinary controls, 200–240ms phone entry, the documented sheet curve, shared theme variables, no motion library. New regressions live in `apps/web/e2e/motion.spec.ts` and `apps/web/e2e/mobile-motion.spec.ts`; share only behavior helpers under `e2e/motion-helpers.ts` if needed.

## Boundaries

Use existing SolidJS and browser APIs; add no dependencies. Preserve focus restoration, Escape handling, synchronous mobile editor focus, card measurements and the world-only camera transform. Preserve documented dog overshoot, burial-copy motion and ordinary sheet entry timing. Do not change server APIs, schemas or permissions.

## Verification

Run the new motion and mobile-motion Playwright cases in WebKit and Chromium, both themes, and normal/reduced motion. Inspect real input paths and recorded samples, not only computed declarations. Run workspace typecheck and unit tests, then full browser suite and headed canvas/sticker performance checks once integrated. See `motion-audit.md` for before captures. Check affected native and physical-phone interactions when hardware is available; record any unavailable check explicitly.

## Done when

The selected behavior meets the target above, its regressions pass in both engines, and the motion review verdict is Approve. Hardware verification gaps remain visible in the integration report.
