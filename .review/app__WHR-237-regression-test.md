---
branch: app/WHR-237-regression-test
linear: WHR-237
tier: low
reviewed_head: f5d2351
rounds: 2
builder: EM (Claude Code, sonnet)
reviewers:
  code-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 2
invariants: []
p1: []
tickets: []
---

The WHR-230 brand-new-campaign regression test in
`tests/e2e/campaign-timing-real.spec.ts` used to `test.skip()` whenever a
campaign already existed in the worker's shared isolated schema, which was
every real run (the file's own first test always creates one). The test had
never actually executed. Fix: moved it to run first in the file, right
after the shared helpers, so it is guaranteed the worker's freshly migrated,
campaign-free schema before any other test mutates it. Replaced the old
`test.skip()` guard with `expect(before.campaign).toBeNull()`, which fails
loudly instead of silently skipping if the ordering assumption is ever
broken. No assertion was weakened. Removed its old copy from the bottom
`test.use({ timezoneId: "Asia/Tokyo" })` describe block, which it never
needed (the test checks only that typed text survives re-render, never an
offset-derived instant).

Proved the test guards the real bug: reverted the `setWallClock` fix in
`src/ui/admin/settings-giveaway.tsx` locally (re-deriving `wall` from the
committed instant each render, as before WHR-230), ran the regression test
— it failed in both projects with the expected
`expect(locator).toHaveValue("2026-02-01")` / `Received: ""`, proving the
bug reproduces. Restored the fix (`git diff` clean on that file) and reran —
passed in both projects. Full file then ran clean: 26/26 passed, 0 skipped,
0 failed, in both `desktop` and `attendant`.

Round 1 (code-reviewer, PASS): no blocking findings. Three non-blocking
nits: a stale `seedTiming` doc comment pointing at the moved test, a stray
blank line, and imprecise wording in the new ordering comment (claimed
every later test creates a campaign; only the very next one does). Fixed
all three in f5d2351. Round 2 (code-reviewer, PASS): confirmed the delta
fixes exactly those three nits, nothing else changed, no new issues.

Gates on f5d2351: `pnpm typecheck && pnpm lint` clean (pre-existing
unrelated `<img>` warnings only); `pnpm test` 1055/1055 unit tests passed;
`pnpm build` succeeded; `pnpm test:e2e -- tests/e2e/campaign-timing-real.spec.ts`
512 passed/4 skipped/0 failed across the full suite, including the target
file's 26/26.
