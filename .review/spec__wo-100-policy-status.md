---
branch: spec/wo-100-policy-status
linear: WHR-100
tier: high
reviewed_head: pending
rounds: 0
builder: spec-em
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Remap ten domain errors to 409 and specify private per-policy health status without weakening gates.
  files: docs/engineering/contracts/m1.md, m2.md, m3.md, m4.md, operations.md
  approach: Amend endpoint tables and shared rules in place; define named health flags with a public aggregate and live settings permission for details.
  tests: Status inventory, paragraph limit, typecheck, lint, unit tests, build and independent code/security/integrity review.
  risks: Status drift, configuration disclosure, false readiness and accidental authorization or credit changes.
invariants: [I-07, I-09, I-12, I-20, I-22, I-26, I-27, I-35, I-36, I-45, I-46, I-49]
p1: []
tickets: []
---
Specification only. Runtime implementation remains WO-core-7d and the respective M3/M4 work orders.
