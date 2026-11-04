# Design system implementation plan

Goal: Deliver WO-app-1’s vendored design system, typed wrappers, dev gallery and reusable shells.
Spec: [gallery brief](../briefs/design-system-gallery.md), approved WO-app-1 (WHR-2).
Architecture: React wrappers emit the documented wr- contract over unchanged vendored CSS. Local fonts and Tailwind token mappings supply shared presentation. The gallery uses fictional fixtures only and returns 404 outside development.

## Global constraints

No real screens, business data, authentication, capture persistence or service worker. src/styles/design-system holds source/date-marked CSS and original fonts. Overrides live in app.css. Phone 390/360px, 48px standard targets (44px floor); admin 1440px, collapses below900. No runtime product-docs imports. No fake credit claims. Root tooling changes are limited to the explicit Tailwind integration this work order requires.

## Tasks

- [x] Frontend builder: inspect every component README/preview; vendor tokens/bundle/fonts and asset provenance; integrate self-hosted font imports and Tailwind colours/spacing/radii/shadows from tokens, no default palette. Verify byte equality after CSS source header and font requests.
- [x] Frontend builder: typed wrappers for all 16 components in src/ui, reusable attendant/admin shells, and /dev/gallery. Match the component markup and appearance; use semantic buttons/links/labels/pressed/current/errors and real fixture image. Make preview state interactive where it demonstrates a control. No live workflows or broken production navigation.
- [x] Test engineer, separate worktree/thread: meaningful Playwright checks for production exclusion, label/error relationships, pressed state, disabled actions, local fonts, 360px overflow and admin responsive shell. Gallery screenshots versus each reference preview.html; report visual differences and commit report/screenshots. Use fixture-only gallery, no DB needed here.
- [ ] EM: rerun typecheck/lint/test/build and test:e2e on final head. Compare vendored files and runtime imports. Required diff-scoped code/integrity review, fixes within medium cap2, evidence validation, staging PR and merge only after green CI.
- [ ] EM: update lane, STATUS and coverage without claiming real workflow invariants. READY with PR, smoke runbook and fidelity report; Earl accepts phone smoke.

## Review focus

- Production route exclusion: production request to /dev/gallery must404; no runtime toggle may expose it.
- Font glyphs/assets: local Plex Sans renders ₦ and all eight source font files load; no external font requests.
- Accessibility: labels/error descriptions and segment/nav state match DOM semantics; no nested interactive controls.
- Responsive overflow: no clipped phone content at360; admin tables scroll, sidebar collapses below900; touch targets keep phone floor.
- Fixture honesty: no sample route implies actual authentication, photo capture, persistence or loyalty credit.

Smoke: [runbook](../qa/smoke-2026-11-04-design-system.md), written before builder dispatch. Execution method is the repository’s EM→builder→independent test/reviewer protocol; approval is supplied by the work order and current session.
