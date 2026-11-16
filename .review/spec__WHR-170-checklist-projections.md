---
branch: spec/WHR-170-checklist-projections
linear: WHR-170
tier: high
reviewed_head: pending
rounds: 0
builder: spec-em
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: specify truthful nine-check outcomes and narrow P-30 selection reads
  files: docs/engineering/contracts/m4.md, docs/engineering/decisions/INDEX.md, docs/engineering/decisions/technical.md
  approach: extend WHR-22 with live and immutable stored projections, scoped selectors, exact authority and stale-view rules; preserve WHR-158 and WHR-162
  tests: typecheck, lint, unit tests, build, contract and link inspection, independent code/security/integrity review
  risks: inferred photo absence, historical account omission, alias-person approval, stale pages and accidental certification
invariants: [I-06, I-07, I-09, I-11, I-26, I-28, I-35, I-40, I-41, I-45, I-45a, I-46, I-49]
p1: []
tickets: []
---
Specification only. No application code, runtime policy activation, STATUS, coverage-map or lane edits.
