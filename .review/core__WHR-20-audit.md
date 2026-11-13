---
branch: core/WHR-20-audit
linear: WHR-20
tier: high
reviewed_head: 0000000
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Implement amended M3 audit search and detail and AU-01 through AU-10 without rewriting historical rows.
  files: src/shared/contracts/audit.ts, src/server/modules/audit/**, src/app/api/admin/audit/**, prisma/**, existing domain audit writers, scripts/ops/review-evidence.mjs, tests/**
  approach: Strict typed action-specific persistence with immutable snapshots, independent safe historical projection, live scoped authorization, bounded keyset search, append-only database guards and atomic domain events.
  tests: Real PostgreSQL authorization, Lagos bounds, cursor binding, snapshots, append-only guards, writer replay and rollback, operator and export fencing, and seeded privacy canaries across storage responses and logs.
  risks: Preserve credit and evidence resolver semantics, exact committed boundaries, historical rows and protected provenance; never expose credentials or unrestricted notes.
invariants: [I-07, I-09, I-18, I-22, I-26, I-31, I-35, I-39, I-40, I-41]
p1: []
tickets: []
---
Implementation plan committed before builder dispatch. Review verdicts pending.
