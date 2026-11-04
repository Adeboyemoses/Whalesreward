# lane:spec
WO-spec-1 (WHR-32) Spec lane, M1 data model and contracts: BUILD since 2026-11-04

## In flight
- PR #4 merged into staging at 7d92cb6; all five CI checks passed, and EM reran typecheck, lint, unit (1) and build. Earl notified; WHR-3 dependency cleared.
- PR #5: existing security/integrity PASS verdicts preserved; contract content unchanged. Local branch includes staging through 176de11, but not #4 yet. Git metadata writes are now denied in spec-contracts (FETCH_HEAD and ORIG_HEAD.lock).
- PR #1: branch includes staging through 176de11; local typecheck, lint, unit (1), build passed. Existing evidence is stale after base update and needs all three reviewers again.
- Prior priority child WHR-37 merged in PR #6.

## Next
- Restore Git metadata write access; finish #5, then #1. Rerun gates on final heads and require green CI before each merge.
- Await Earl's answer authorizing PR #1 review round 4; existing evidence records 3 rounds and 9 dispatches. Do not bypass the cap.
- Close WHR-32 only after both remaining PRs merge. No next work order started.

## Earl's gos
- Earl requested merges in order #4, #5, #1, then close WO-spec-1 and stop.
- No review-cap exception received in this session.

## Risks
- PR #1 exceeds the high-tier dispatch flag (9 > 8) from the earlier session.
- WHR-38 trusted capture evidence and WHR-39 nonreplacement retirement remain open policy gates.
- Runtime model ID unavailable; metrics below describe this resumed session only.

dispatches=0 prs=0 rounds_max=0 escalations=1 model=unavailable
