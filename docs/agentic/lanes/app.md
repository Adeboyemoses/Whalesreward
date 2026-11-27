# lane:app
WHR-237 brand-new-campaign regression test fix: ACCEPTED since 2026-11-27

## In flight
- [Feature PR #194](https://github.com/Adeboyemoses/Whalesreward/pull/194): merged squash to staging at `1d9c7c3d6df0ddf1c4bec70e6fe34a1baa5cc2c4`. Reviewed head `f5d2351` (round 2); evidence `.review/app__WHR-237-regression-test.md`.
- Test-only: the WHR-230 brand-new-campaign regression test self-skipped whenever an earlier test in the file had already created the worker's one campaign, which was every real run. Moved it to run first in the file instead, so it's guaranteed a campaign-free state; replaced the `test.skip()` guard with `expect(before.campaign).toBeNull()`, which fails loudly instead of silently skipping if that ordering assumption is ever broken. No assertion weakened.
- Proof the test guards the real bug: reverted the WHR-230 `setWallClock` fix locally, confirmed the test fails with the expected `toHaveValue` mismatch, restored the fix, confirmed it passes. Both runs recorded in the evidence file.
- EM: typecheck/lint/build clean, unit 1,055/1,055, `campaign-timing-real.spec.ts` 26/26 passed (no skips, both projects), full `test:e2e` 512 passed/4 unrelated skips/0 failed. Code-reviewer PASS round 1 (3 non-blocking nits, fixed), PASS round 2.

## Next
- Nothing further; this closes WHR-237. WHR-236 (TimezoneCombobox has no "UTC" entry) remains open as a separate found-work product question. WHR-230 itself still awaits Earl's phone/staging recheck of campaign set-up — unaffected by this fix.

## Earl's gos
- 2026-11-27: "Option A, commissioned for T2" — approved WHR-237 directly on the work order.

## Risks
- WHR-236: TimezoneCombobox has no selectable "UTC" entry (`Intl.supportedValuesOf` never returns that alias); filed as found-in:WHR-230, open for Rook/Earl.
- Earl's phone/staging verification of WHR-230's campaign set-up remains pending; no acceptance inferred from this fix.

dispatches=2 prs=1 rounds_max=2 escalations=0 model=claude-sonnet-5-5
