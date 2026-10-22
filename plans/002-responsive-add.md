# 002 — Accept deliberate Add reopening

- **Status**: IMPLEMENTED — focused review approved
- **Commit**: c076eee2
- **Estimated scope**: 1 component plus shared mobile regressions; remove the input guard
- **Severity**: HIGH
- **Category**: Input responsiveness

## Problem

See confirmed finding 2 in `motion-audit.md`. Current source is `apps/web/src/ui/MobileDock.tsx`:

```tsx
    if (performance.now() - toggledAt < 350) return
```

## Target and ordered implementation

Delete `toggledAt` and the toggle wrapper; bind the existing button directly to `setOpen(!open())`. Keep sheet/card creation and synchronous focus code unchanged. Regress with real touchscreen taps: open Add, tap outside after 90ms, tap Add again after 60ms, assert both Add clicks were delivered less than 350ms apart and the sheet reopens. Repeat with reduced motion; create a note after reopening and verify the editor is focused.

## Repo conventions

Follow `apps/web/DESIGN.md`: 140–160ms ordinary controls, 200–240ms phone entry, the documented sheet curve, shared theme variables, no motion library. New regressions live in `apps/web/e2e/motion.spec.ts` and `apps/web/e2e/mobile-motion.spec.ts`; share only behavior helpers under `e2e/motion-helpers.ts` if needed.

## Boundaries

Use existing SolidJS and browser APIs; add no dependencies. Preserve focus restoration, Escape handling, synchronous mobile editor focus, card measurements and the world-only camera transform. Preserve documented dog overshoot, burial-copy motion and ordinary sheet entry timing. Do not change server APIs, schemas or permissions.

## Verification

Run the new motion and mobile-motion Playwright cases in WebKit and Chromium, both themes, and normal/reduced motion. Inspect real input paths and recorded samples, not only computed declarations. Run workspace typecheck and unit tests, then full browser suite and headed canvas/sticker performance checks once integrated. See `motion-audit.md` for before captures. Check affected native and physical-phone interactions when hardware is available; record any unavailable check explicitly.

## Done when

The selected behavior meets the target above, its regressions pass in both engines, and the motion review verdict is Approve. Hardware verification gaps remain visible in the integration report.
