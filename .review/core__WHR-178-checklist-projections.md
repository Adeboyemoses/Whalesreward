---
branch: core/WHR-178-checklist-projections
linear: WHR-178
tier: high
reviewed_head: 20a4515fef31ce02227a0fa48da83bce9ae2f44d
rounds: 4
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 18
plan:
  goal: implement six read-only T-21 giveaway projections without changing grouped readiness or mutation behavior
  files: src/shared/contracts/giveaway-projections.ts, src/server/modules/giveaway/**, src/app/api/admin/giveaway/**, tests/integration/giveaway-projections*.test.ts, tests/helpers/giveaway-projection*.ts
  approach: share existing evaluator and candidate predicates, use consistent authorized snapshots, strictly validate retained history, bind opaque views and stable cursors to all relevant state and timing phase
  tests: every m4 T-21 acceptance item named against local disposable PostgreSQL, all six routes over real HTTP, regression unit integration and build gates
  risks: false pass from missing proof, authority or identity leakage, stale selections, changed grouped blockers, historical recomputation
invariants: [I-07, I-11, I-25, I-26, I-35, I-40, I-41, I-42, I-45, I-45a, I-46, I-48]
p1: []
tickets: [WHR-179, WHR-182]
escalation: Earl chose Option A on 2026-11-18 (WHR-182), one bounded test-only round 4; any production-code change or new finding stops work; no round 5
---

Approved scope: WHR-178 and m4.md T-21, including its complete acceptance list.
Base: 6d2e504, containing WHR-176, WHR-179, WHR-181 and approved T-21.
1. Add strict additive schemas and six thin GET routes; preserve existing mutation bodies and Readiness.
2. Reuse readiness source predicates for live rows; validate immutable stored checks without recomputation.
3. Implement narrow authority, required historical accounts, current phones, and exact incomplete candidates.
4. Protect stable page/view bindings, timing phase changes, bounds, generic errors and read-only behavior.
5. Name every acceptance case in real PostgreSQL tests and exercise every route through an HTTP listener.
6. EM reruns gates; code/security/integrity reviews, cap 3 plus Earl-authorized bounded round 4; merge green PR to staging.
No STATUS, coverage-map or lane changes. No cloud operations or real databases.

Earl's 2026-11-18 WHR-182 Option A authorizes one bounded test-only round 4.
Round 4 code/security/integrity PASS the named test and verification records; no new findings.
Any production-code change or new finding stops work; no round 5.
Only the named regression changes after parked 6bf2cd2; production files are identical.
Second approval fails exclusion_stale; ordinary SQL appends retained duplicate approval.
Native guards remain enabled; certification must fail phone_check_stale.
Matching historical pins exercise stale readiness and preparation finalization_blocked.
All refusals assert no effects; expanded test timeout 30 to 60 seconds only.
EM and code-reviewer focused PostgreSQL tests PASS independently; typecheck/lint, 997 unit tests and build PASS.
Review self-tests 53, guard self-tests 94, time 5 per timezone PASS.
Local PostgreSQL 15 broad runs hit unchanged fixture/DDL timeouts, not green evidence.
Full supported PostgreSQL 16 final-head CI is required, including all 67 named tests,
all six real HTTP GET routes and named authority/writer/snapshot/receipt regressions.
Final CI outcomes/counts are recorded on PR #164 and the WHR-178 READY comment.
No shim, guard relaxation, skip, expected-failure wrapper or bypass.
Exact names: docs/qa/whr-178-named-tests.md; mapping: whr-178-acceptance.md.
Dispatch flag: 18 exceeds 8; bounded round 4 explicitly authorized, no round 5.
