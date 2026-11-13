---
branch: core/wo-13-reports
linear: WHR-24
tier: high
reviewed_head: pending
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Implement operational reports, overview and immutable private exports per amended M4 and WO-core-13 gaps.
  files: src/server/modules/reports/**, src/server/modules/overview/**, src/server/modules/customers/**, src/server/modules/audit/**, src/server/adapters/**, src/shared/contracts/**, src/app/api/admin/**, prisma/**, tests/**, src/instrumentation.ts
  approach: Share one exact accepted-contribution predicate and database generation across snapshot reads; freeze export inputs and reuse fenced bounded card-export lifecycle with storage outside locks and live creator authority.
  tests: Real PostgreSQL gaps and report verification including stored meter pairs, original attribution, flags, buckets, generations, overflow, precision and formula safety, audit privacy, revocation, leases and expiry; full repository gates.
  risks: Generation must cover all contributing writers; immutable snapshot and audit atomicity, export precision and lock-free storage require concurrency tests; no campaign policy activation or evidence deletion.
invariants: [I-05, I-07, I-09, I-29, I-40, I-41, I-42, I-44, I-45, I-48, I-52]
p1: []
tickets: []
---
Approved scope: WHR-24 / WO-core-13, M4 amended by WO-spec-4a.
No STATUS, coverage-map or lane file changes, per Earl and WHR-63.
Review cap is three rounds; independent code, security and integrity verdicts required.
