# Writing public documentation

Public content lives in `apps/web/src/docs/content/<slug>.json`. Copy [feature.template.json](feature.template.json) there and rename both file and slug. The existing SolidJS/Vite build renders it; there is no Markdown plugin, CMS or central navigation list to maintain. Keep architecture, QA and capture provenance in `docs/`, outside user-facing content.

## Write around a user goal

Use a short, stable, lower-case hyphenated slug (for example `align-cards`) and a title that names an outcome. Summary is one short sentence (maximum 240 characters); title maximum 120 characters. Supply benefit and a complete sentence for outcome. Optional `keywords` add other words people search with ("color", "photo"); they are never shown. Order is a finite number; ties sort by title. Navigation and landing cards come from these same files.

Choose a category: `getting-started`, `working-on-boards`, `research-media`, `writing-drawing`, `sharing`, `reference`. Empty categories stay out of the UI. Choose `kind`: `task` for instructions, `explanation` for a concept, `reference` for facts or lookup. Do not use a task guide as a home for implementation notes.

Every section has a stable, unique `id`, a title and actual content. IDs `root`, `dn-theme`, `docs-main` and `docs-navigation` are reserved for the page shell; the validator rejects collisions. Supported blocks are `paragraphs` (plain text), `flow`, `figures`, `callout` and `links`. HTML and Markdown are displayed as text, never executed. Omit optional sections and fields rather than leaving empty headings or lists. Relevant prerequisites belong in the optional `prerequisites` list. Use a concrete example inside the description and flow; do not imply an unfinished feature has shipped.

A flow contains `entry`, numbered `steps` with explicit `action` and visible `result`, `completion` (including save/reopen behavior) and `correction` (Undo, cancellation or recovery). Document exact control labels. Shortcuts, access, platform differences, troubleshooting and limitations belong in sections only when useful. Screenshots supplement the instructions; the text must explain the full task independently.

## Add real screenshots

Store optimized PNG or WebP assets under `apps/web/public/docs/assets/<slug>/`. Use descriptive lower-case hyphenated filenames, such as `selected-cards-aligned.png`. Capture synthetic populated content through actual UI; no mock or generated screenshots, user accounts, private boards, local paths, tokens or credentials. Use consistent crops that retain the real control and result. Maximum intrinsic width is 1600 pixels and maximum file size is 1.5 MB; crop/optimize rather than uploading raw displays. Prefer WebP for photographs, PNG for crisp UI text.

Add a figure to the relevant section:

```json
"figures": [{
  "src": "/docs/assets/your-feature/selected-cards-aligned.png",
  "alt": "Three selected reference cards share their top edge beside the Align top control.",
  "caption": "Align top lines up the selected cards using the selection bounds.",
  "width": 1440,
  "height": 900
}]
```

Capture each screenshot in both appearances and add the dark one as `"darkSrc"` (for example `selected-cards-aligned-dark.png`). It must be the same size as the light one; readers see the copy that matches their Appearance, and the other is never downloaded. Dimensions must match the actual image bytes; the renderer reserves their aspect ratio. Alt describes meaningful visible evidence, while the caption explains the demonstrated state. Record tested revision, platform/build, synthetic fixture, capture method and QA round in your own `docs/qa/<feature>/` log. User-facing pages do not contain those records. A published task requires at least one screenshot and one flow. Missing referenced assets fail validation even in a draft. Until actual captures exist, omit `figures` and leave `status` as `draft`.

## Links, publication and preview

Set `related` to other published slugs. `links` (article-wide or in a section) use `{ "label": "Read the guide", "href": "/docs/other-guide#heading-id" }`. The home URL is `/docs`; external URLs must use HTTPS. Internal published links and heading anchors are checked. Leave cross-feature related lists empty until their targets are published, then add them in integration.

`status: "draft"` removes the article from public routes, navigation, search **and the JavaScript article data emitted by Vite**. There is no query-string draft bypass. Public assets are static; never put sensitive material there, even for a draft. To preview a draft, temporarily change it to `published` locally, add valid final figures for task guides, and restore `draft` before committing until behavior and evidence are verified. To test text layout before figures, use a local reference-kind fixture, and do not commit the fixture as a shipped task guide. The template itself is outside the public content directory and never published.

```sh
pnpm --filter web dev --host loop13.localhost --port 16220 --strictPort
# Open http://loop13.localhost:16220/docs/<slug>
pnpm --filter web docs:check
pnpm --filter web typecheck
pnpm --filter web build
pnpm test
```

Use your assigned hostname and ports, and obey shared UI/heavy queues and leases. Build and typecheck run the same content check automatically. `docs:check` checks metadata, section/flow shape, published links and related guides, asset existence/type/dimensions/size. It cannot verify that screenshots are authentic or instructions are true: authors and integration QA must do that.

Review the landing → guide → heading → related guide → Back flow, direct-link refresh and unknown routes anonymously. Review 360/600/720/1440 widths, both themes, long titles/steps, browser zoom, image sizing, keyboard navigation, Escape/focus restoration, reduced motion and empty search. Check that docs make no private API requests and never mount the canvas. The ordinary Playwright configuration runs `e2e/docs.spec.ts` on Chromium and WebKit; run heavy suites only in your scheduled slot.

## Ownership and review gates

Feature loops 1–11 own their actual delivered feature guides and screenshots in the same reviewable source change. Loop 13 owns the foundation and template. Loop 12 verifies guide claims against the integrated UI and checks final publication state. Draft-only content does not complete a feature's docs gate. Deliver final screenshots with concise captions and tested revision to MAIN chat; explicit user screenshot approval is required before any merge. No merge/deploy is authorized by this guide.
