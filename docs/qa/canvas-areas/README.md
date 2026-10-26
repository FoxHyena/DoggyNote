# Canvas areas public guide QA

The feature was merged in PR #79 at `7a0ceaec2a401c3319a8e42a5e279fa30ffed27d`. The public article is `apps/web/src/docs/content/canvas-areas.json`, at `/docs/canvas-areas`.

The final capture round uses `fd9d60d6d55b6a4e05dfd99ff717f5a832dfd582`, including the user's requested Tidy refinement: four neatly arranged blocks from the existing Phosphor pack, shared by the header, area actions, context menu and development playground.

## Capture provenance

Captured on macOS with Playwright Chromium at a 1440×900 viewport, against the merged web app through local Vite on port 5499 and an isolated real Worker/D1 fixture on port 9088. This is development-build screenshot evidence; the production browser suites separately verify the same delivered feature and public renderer.

The synthetic Tracking Collars project contains Doing and Ready columns, a prototype to-do, a note about fit, and a separate Launch checklist. It uses no user board data. The three public examples are actual rendered UI states: the expanded layout, Add to area, and collapse with a projected external arrow. Each has a light/dark twin. Captures exclude account chrome and credentials. They are 1320×600 (expanded/menu) or 1320×320 (collapsed), each under 60 KB.

`capture.mjs` reproduces the public examples against a local test server only. Run with `CAPTURE_BASE_URL=http://localhost:5499 node docs/qa/canvas-areas/capture.mjs` after starting the normal isolated e2e Worker and web preview. Its fixture login is the existing local e2e account; never point it at production.

`layout.mjs` captures the signed-out article at widths 360, 600, 720 and 1440 in both themes, plus phone flow details. It waits for figure loading before capturing. All eight width/theme combinations load the correct images, stay within the viewport and make no /api requests. Reduced motion is enabled. The text covers the task independently of screenshots.

## Validation

- Content check: 12 published articles, 1 draft; links, figure dimensions and image bytes valid.
- Full typecheck passes.
- All 398 unit/integration tests pass.
- Existing guides and mobile-guides production suites: 29 passed initially; one unrelated keyboard skip-link focus assertion failed on Chromium. That check passes in both Chromium and WebKit on isolated rerun (2 passed). Article rendering, theme-specific images, anonymous access, routes, search, related links and mobile navigation passed.
- Visual inspection covers the six public screenshots and all eight responsive article captures, plus both phone flow details. The established guide renderer is unchanged.

## Publication gate

The user explicitly approved the screenshot examples and instructed merge and release, then requested the Tidy icon refinement and selected “Neatly arranged blocks.” The examples were refreshed with that approved icon and the same synthetic content and crops. This records the user authorization required by `docs/authoring/README.md`; it is not an independent source of release authorization.
