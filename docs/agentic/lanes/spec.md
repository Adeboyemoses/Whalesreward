# lane:spec
WO-spec-3b (WHR-61) capture interval and M3 capture review: READY on reviewed green staging merge, 2026-11-05

## In flight
- Specification PR branch `spec/wo-3b-capture`; merged PR and code/security/integrity verdicts are recorded on [WHR-61](https://linear.app/phaneum/issue/WHR-61). READY takes effect only after merge and green CI; then stop for Earl's verification.
- P-20 refines P-18: [S, min(R, original offlineExpiresAt)]; receipt after expiry alone does not hold. M3 evidence-backed capture review requires sales AND dateReview and clears only capture blocks or cancels.
- No application code or board parity. Q-528 remains pending. WHR-61 stays In Review, not Done, at READY.

## Next
- Stop at READY. WO-core-4a implements the interval; WO-core-9 implements capture review. No further spec work order is started.

## Earl's gos
- 2026-11-05: “[spec · WO-spec-3b] You are the engineering manager for lane:spec. Work order: WO-spec-3b (WHR-61), Earl's P-20 refinement of the capture interval and the M3 capture review. Take it to READY, then stop. Follow AGENTS.md.”

## Risks
- Client Q-528 confirmation remains pending; Rook should carry P-20 into the read-only product docs.
- Existing implementation remains P-18 until WO-core-4a; capture decision/evidence checks await WO-core-9. Missing/insufficient evidence never grants credit.
- No cloud or main action authorized. Runtime full model ID unavailable.

dispatches=6 prs=1 rounds_max=2 escalations=0 model=unavailable
