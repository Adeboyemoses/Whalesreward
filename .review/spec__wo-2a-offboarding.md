---
branch: spec/wo-2a-offboarding
linear: WHR-79
tier: high
reviewed_head: pending
rounds: 0
builder: spec-em
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: specify assignment-ending offboarding under P-21 without application code
  files: docs/engineering/contracts/m1.md, docs/engineering/contracts/m2.md, docs/engineering/data-model.md, docs/engineering/decisions/INDEX.md
  approach: guarded idempotent assignment end with atomic live-authority revocation and immutable P-20 queue history
  tests: EM typecheck lint unit build and spec consistency checks; independent code security integrity review
  risks: offline phones cannot observe revocation instantly; implementation is separate core work; shared READY records follow in a separate PR
invariants: [I-01, I-03, I-04, I-05, I-05a, I-06, I-07, I-09, I-22, I-28, I-35, I-36, I-41, I-45a]
p1: []
tickets: []
---
Approved WO-spec-2a scope and Earl's WHR-76 decision; specification only.
