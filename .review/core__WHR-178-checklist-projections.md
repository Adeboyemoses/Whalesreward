---
branch: core/WHR-178-checklist-projections
linear: WHR-178
tier: high
reviewed_head: e46a1afaa3977a56b28660d74ff2ee3ccae58615
rounds: 3
builder: backend-engineer
reviewers:
  code-reviewer: FAIL
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 14
plan:
  goal: implement six read-only T-21 giveaway projections without changing grouped readiness or mutation behavior
  files: src/shared/contracts/giveaway-projections.ts, src/server/modules/giveaway/**, src/app/api/admin/giveaway/**, tests/integration/giveaway-projections*.test.ts, tests/helpers/giveaway-projection*.ts
  approach: share existing evaluator and candidate predicates, use consistent authorized snapshots, strictly validate retained history, bind opaque views and stable cursors to all relevant state and timing phase
  tests: every m4 T-21 acceptance item named against local disposable PostgreSQL, all six routes over real HTTP, regression unit integration and build gates
  risks: false pass from missing proof, authority or identity leakage, stale selections, changed grouped blockers, historical recomputation
invariants: [I-07, I-11, I-25, I-26, I-35, I-40, I-41, I-42, I-45, I-45a, I-46, I-48]
p1: ["WHR-182: unchanged regression assumes conflicting approval succeeds; decision pending"]
tickets: [WHR-179, WHR-182]
---

Approved scope: WHR-178 and m4.md T-21, including its complete acceptance list.
Base: 6d2e504, containing WHR-176, WHR-179, WHR-181 and approved T-21.
1. Add strict additive schemas and six thin GET routes; preserve existing mutation bodies and Readiness.
2. Reuse readiness source predicates for live rows; validate immutable stored checks without recomputation.
3. Implement narrow authority, required historical accounts, current phones, and exact incomplete candidates.
4. Protect stable page/view bindings, timing phase changes, bounds, generic errors and read-only behavior.
5. Name every acceptance case in real PostgreSQL tests and exercise every route through an HTTP listener.
6. EM reruns gates; independent code/security/integrity reviewers, maximum three rounds; merge green PR to staging.
No STATUS, coverage-map or lane changes. No cloud operations or real databases.

BLOCKED, not READY: WHR-182 tracks the unchanged regression expectation mismatch.
Rebased from parked 6aa6ea6 onto staging 6d2e504, including WHR-179 and WHR-181.
WHR-179's duplicate-exclusion guard is preserved; no mutation behavior changed.
Both projection test files remain byte-for-byte unchanged from the parked draft.
Round 3: security PASS, integrity PASS; code FAIL for the regression setup assumption.
The second overlapping approval now correctly fails with exclusion_stale before certification.
Earl requested the test unchanged and cap 3; no additional code/test edits or review dispatched.
WHR-182 asks Option A update the test with downstream coverage and one bounded review;
Option B preserve the test and leave the draft parked. Default B pending Earl's reply.
EM typecheck/lint, 997 unit tests and build PASS; four pre-existing image warnings.
Clean serial non-superuser PostgreSQL named suites: 66 PASS / 1 FAIL / 67; no skips.
All six actual GET routes pass through localhost HTTP, including authority/input cases.
All 81 existing giveaway regressions PASS, 12 files; includes photo receipts and WHR-179 guards.
Review self-tests 53, guard self-tests 94, time 5 in each timezone PASS.
Local PostgreSQL 15; PG16 init blocked by sandbox shared memory; supported PG16 CI required.
No shim, safety-guard relaxation, skip, expected-failure wrapper or bypass.
Exact names: docs/qa/whr-178-named-tests.md; mapping: whr-178-acceptance.md.
Dispatch flag: 14 exceeds 8; round cap 3 reached. No READY or merge claim.
