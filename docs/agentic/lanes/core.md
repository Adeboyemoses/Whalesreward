# lane:core
WO-core-4 (WHR-6) sync and evidence: BUILD, 5 November 2026

## In flight
- WHR-28 FIX and WHR-53 ACCEPTED/Done: closeout PR #34 merged7b0c3ab, independent code PASS, EM unit80/typecheck/lint/build and five CI checks green.
- WO-core-4 implements strict M1 lookup/sync, durable originals and receipt, upload permission, validated immutable final evidence, atomic accepted revision/audit and safe orphan skeleton. P-18 lives in one server policy module.
- Independent named tests use real PostgreSQL and MinIO. Builder verification94 unit/91 integration; EM final gates and three-role high-tier review in progress. No credit or READY claim from builder output alone.
- WHR-59 resolved from existing M3 amendment: M1 policy_review_required; detailed policy blocks remain separate from holds. No contract change or new product decision.

## Next
- Merge only after final EM gates, independent verdicts, evidence and CI pass. Post named output on WHR-6, move In Review/READY and stop.
- docs/qa/smoke-2026-11-05-core-sync.md separates local automated proof from Earl's deployed Spaces/phone smoke. Upload UI remains WO-app-3.

## Earl's gos
- 2026-11-05: “Earl accepted the WHR-28 FIX and WO-core-1d (WHR-53); close both.”
- 2026-11-05: “Take it to READY with the named tests' output pasted, then stop.”

## Risks
- No cloud-resource, credential or staging-data operations. Actual Spaces PUT/finalize smoke is not claimed by MinIO/SDK tests. WHR-58 remains separate.
- P-18/Q-528 remains the approved build default; unresolved intervals retain zero credit. No correction/review UI or policy resolution in scope.
- Runtime model ID unavailable. Metrics at first review dispatch, including closeout reviewer.

dispatches=6 prs=2 rounds_max=1 escalations=0 model=unavailable
