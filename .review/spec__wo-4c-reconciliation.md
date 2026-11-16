---
branch: spec/wo-4c-reconciliation
linear: WHR-156
tier: high
reviewed_head: pending
rounds: 0
builder: spec-em
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: specify P-30 reconciliation, phone checks and exclusions, and trusted photo receipt for WO-core-12
  files: docs/engineering/contracts/m4.md, docs/engineering/data-model.md, docs/engineering/contracts/m3-audit-inventory.md, docs/engineering/contracts/operations.md, docs/engineering/decisions/INDEX.md
  approach: amend M4 in place with strict versioned records, existing permission recommendations, registry validation, immutable receipts and serialized snapshot guards; distinguish settled policy from Earl confirmations
  tests: EM typecheck, lint, unit tests, build, link and paragraph checks; independent code, security and integrity specification review
  risks: unknown phone-only queues, authority assumptions, receipt backdating, pending P-29 proposals and stale reconciliation must never bypass readiness or rewrite snapshots
invariants: [I-07, I-09, I-11, I-22, I-25, I-26, I-28, I-35, I-40, I-41, I-45, I-45a, I-46, I-48]
p1: []
tickets: []
---
Specification only. No code, STATUS, coverage-map or lane-file edits.
