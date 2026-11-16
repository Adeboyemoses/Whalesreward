---
branch: core/WHR-164-release-discovery
linear: WHR-164
tier: high
reviewed_head: b4dcc7b
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Implement T-20 protected release preparation and complete authorized pending discovery without activation.
  files: src/shared/contracts/**, src/server/modules/**, src/app/api/admin/**, tests/**, prisma/migrations/** only if an index is necessary
  approach: Factor common structural classification from release admission; reuse guarded candidate and policy/history/security locks; project safe admin summaries; query persisted pending state with scoped authenticated tuple cursors and snapshot after first-page serialization lock.
  tests: Named real-Postgres RD-01 through RD-06 covering exact context and targets, classification, interleavings, over-100 precision paging, per-kind access and cursor changes, giveaway blockers and read-only state; non-superuser permission tests; typecheck, lint, unit, build, integration and relevant browser/time gates.
  risks: Protected evidence leakage, drifting snapshots, commit-order paging gaps, mutation regression, admission mistaken for credit; keep v2 unconfigured and use disposable local databases only.
invariants: [I-07, I-09, I-26, I-31, I-33, I-34, I-35, I-41, I-45, I-46, I-48]
p1: []
tickets: []
---

Plan committed before builder dispatch. RD-07 belongs to the later app work order.
