---
branch: core/reconciliation-station-binding
linear: WHR-229
tier: high
reviewed_head: b1827ea
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Bind every station to the exact approved reconciliation-v1 definition.
  files: prisma/migrations/**, tests/integration/**, tests/helpers/**, tests/e2e/**
  approach: Follow P-28 with guarded idempotent existing-station backfill and new-station trigger; seed only bindings.
  tests: Real PostgreSQL upgrade and fresh station, repeat migration, definition guard negatives, real HTTP health and checklist without fixture binding; full required gates.
  risks: Never overwrite immutable existing policy bindings or configure an unsupported definition; preserve campaign and checklist state.
invariants: [I-07, I-45, I-46]
p1: []
tickets: []
---

WHR-229 escaped through fixture-only station bindings. Production migration must provide the binding.
Sweep other migrated definitions and station binding writers; report any additional gap separately.
Per Earl, no STATUS, coverage-map or lane-file edits in this feature PR.
