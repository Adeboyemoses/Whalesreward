---
branch: core/WHR-181-original-date
linear: WHR-181
tier: high
reviewed_head: 03e6c73
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: preserve the true original sale date in original Values after date resolution
  files: src/server/modules/sales/**, src/server/modules/reviews/**, src/server/modules/held-release/**, tests/**
  approach: audit purchase-row original Values builders and repair reads using immutable original data while retaining the current verified date in current projections
  tests: failing then passing real PostgreSQL and real HTTP regressions for ordinary date resolution and P-29 date release, full repository gates
  risks: leaking current date into original history or hiding current verified dates; no schema, endpoint-shape or immutable revision changes allowed
invariants: [I-28, I-34, I-35, I-36, I-45a]
p1: []
tickets: []
---

WHR-181 commissioned by Earl on 17 Nov 2026. Base: origin/staging 03e6c73.
Audit sale detail, reviews, release preparation, reports and audit projections.
Do not edit STATUS.md, coverage-map.md or lane files in this feature PR.
