---
branch: core/WHR-178-checklist-projections
linear: WHR-178
tier: high
reviewed_head: ab915e3
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: implement six read-only T-21 giveaway projections without changing grouped readiness or mutation behavior
  files: src/shared/contracts/giveaway-projections.ts, src/server/modules/giveaway/**, src/app/api/admin/giveaway/**, tests/integration/giveaway-projections*.test.ts, tests/helpers/giveaway-projection*.ts
  approach: share existing evaluator and candidate predicates, use consistent authorized snapshots, strictly validate retained history, bind opaque views and stable cursors to all relevant state and timing phase
  tests: every m4 T-21 acceptance item named against local disposable PostgreSQL, all six routes over real HTTP, regression unit integration and build gates
  risks: false pass from missing proof, authority or identity leakage, stale selections, changed grouped blockers, historical recomputation
invariants: [I-07, I-11, I-25, I-26, I-35, I-40, I-41, I-42, I-45, I-45a, I-46, I-48]
p1: []
tickets: []
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
