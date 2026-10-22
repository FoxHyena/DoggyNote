# 004 — Make sheet dismissal cancellable and interruptible

- **Status**: IMPLEMENTED — focused review approved
- **Commit**: c076eee2
- **Estimated scope**: 1 gesture module plus shared mobile regressions; session lifecycle correction
- **Severity**: MEDIUM
- **Category**: Cancellation/interruption

## Problem

See confirmed finding 4 in `motion-audit.md`. Current source is `apps/web/src/ui/sheet.ts`:

```ts
    window.addEventListener('pointercancel', up)
```

## Target and ordered implementation

Track one active session with sheet, pointer id, dragging/settling phase and cleanup. Ignore other pointer ids during an active drag. Freeze the current computed translateY when re-grabbing a settling sheet, cancel its old timeout and transition handler, and cancel the element entry animation without altering global CSS. Follow the pointer directly via transform; use pointer capture with a guarded synthetic-event fallback. Keep grip 28px, movement threshold 6px, dismissal threshold 80px and velocity threshold .6px/ms. On pointercancel or lost capture roll back; only matching pointerup may commit dismissal. Settle through a CSS transform transition of 180ms on the existing sheet curve cubic-bezier(.22,1,.36,1). Finish on the element transform transitionend, with a 230ms fallback; clear all listeners/timers on interruption, removal or App cleanup. Reduced-motion settles immediately. Prevent native touchmove only during grip-origin pointer sessions, so browser scrolling cannot cancel a deliberate grip drag while sheet-body scrolling stays available. Retain original inline transform/transition after cleanup and never dispatch dismissal on a detached sheet. Test cancellation, second pointer interference, re-grabbing before dismissal, deliberate drag dismissal, removal while pending and reduced-motion immediate dismissal.

## Repo conventions

Follow `apps/web/DESIGN.md`: 140–160ms ordinary controls, 200–240ms phone entry, the documented sheet curve, shared theme variables, no motion library. New regressions live in `apps/web/e2e/motion.spec.ts` and `apps/web/e2e/mobile-motion.spec.ts`; share only behavior helpers under `e2e/motion-helpers.ts` if needed.

## Boundaries

Use existing SolidJS and browser APIs; add no dependencies. Preserve focus restoration, Escape handling, synchronous mobile editor focus, card measurements and the world-only camera transform. Preserve documented dog overshoot, burial-copy motion and ordinary sheet entry timing. Do not change server APIs, schemas or permissions.

## Verification

Run the new motion and mobile-motion Playwright cases in WebKit and Chromium, both themes, and normal/reduced motion. Inspect real input paths and recorded samples, not only computed declarations. Run workspace typecheck and unit tests, then full browser suite and headed canvas/sticker performance checks once integrated. See `motion-audit.md` for before captures. Check affected native and physical-phone interactions when hardware is available; record any unavailable check explicitly.

## Done when

The selected behavior meets the target above, its regressions pass in both engines, and the motion review verdict is Approve. Hardware verification gaps remain visible in the integration report.
