---
branch: core/WHR-178-checklist-projections
linear: WHR-178
tier: high
reviewed_head: 598d51f167116da04f65c2d74e16725e3bf94f5a
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 1}
dispatches: 11
plan:
  goal: implement six read-only T-21 giveaway projections without changing grouped readiness or mutation behavior
  files: src/shared/contracts/giveaway-projections.ts, src/server/modules/giveaway/**, src/app/api/admin/giveaway/**, tests/integration/giveaway-projections*.test.ts, tests/helpers/giveaway-projection*.ts
  approach: share existing evaluator and candidate predicates, use consistent authorized snapshots, strictly validate retained history, bind opaque views and stable cursors to all relevant state and timing phase
  tests: every m4 T-21 acceptance item named against local disposable PostgreSQL, all six routes over real HTTP, regression unit integration and build gates
  risks: false pass from missing proof, authority or identity leakage, stale selections, changed grouped blockers, historical recomputation
invariants: [I-07, I-11, I-25, I-26, I-35, I-40, I-41, I-42, I-45, I-45a, I-46, I-48]
p1: ["fixed protected historical validation and upload reason predicates"]
tickets: [WHR-179]
---

Approved scope: WHR-178 and m4.md T-21, including its complete acceptance list.
Base: ab915e3, containing WHR-176 and the approved T-21 specification.
1. Add strict additive schemas and six thin GET routes; preserve existing mutation bodies and Readiness.
2. Reuse readiness source predicates for live rows; validate immutable stored checks without recomputation.
3. Implement narrow authority, required historical accounts, current phones, and exact incomplete candidates.
4. Protect stable page/view bindings, timing phase changes, bounds, generic errors and read-only behavior.
5. Name every acceptance case in real PostgreSQL tests and exercise every route through an HTTP listener.
6. EM reruns gates; independent code/security/integrity reviewers, maximum three rounds; merge green PR to staging.
No STATUS, coverage-map or lane changes. No cloud operations or real databases.

BLOCKED, not READY: WHR-179 is an existing mutation-integrity acceptance failure.
Two phones can have applicable exclusions for one purchase; certification/preparation succeeds.
The user requires mutation behavior unchanged; a separate fix needs explicit authorization.
The open integrity count intentionally keeps review-evidence red; no merge is authorized.
All three independent reviewers PASS the new projection diff in round 2; none waives WHR-179.
Round 1 fixed incomplete protected historical validation, false validation_pending, and a
repeatable-read snapshot that retained verified-person authority across a security-lock wait.
The corrected race asserts a committed binding change and denial; it does not prove label exposure.
EM final code gates: typecheck/lint, 981 unit tests and build PASS.
New non-superuser PostgreSQL projection suites: 66 PASS / 1 FAIL (WHR-179), 67 total, no skips.
Broader giveaway run: 136 PASS / 1 FAIL; receipt suite excluded for its database-name guard.
Full PostgreSQL 16 integration awaits CI; local PostgreSQL 15 has no compatibility shim.
Exact named results: docs/qa/whr-178-named-tests.md; complete mapping: whr-178-acceptance.md.
Each round-2 reviewer also ran eight focused PostgreSQL regressions successfully.
Dispatch flag: 11 exceeds the high-tier flag of 8; review rounds remain 2 of 3.
