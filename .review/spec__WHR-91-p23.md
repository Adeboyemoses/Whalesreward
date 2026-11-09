---
branch: spec/WHR-91-p23
linear: WHR-91
tier: high
reviewed_head: pending
rounds: 0
builder: spec-em
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: specify P-23 signed lookup lower bound without changing runtime code
  files: docs/engineering/contracts/m1.md, docs/engineering/contracts/m2.md, docs/engineering/data-model.md, docs/engineering/invariants.md, docs/engineering/decisions/INDEX.md
  approach: bind immutable receipt to original context and evaluate all histories over the narrowed interval
  tests: document consistency, paragraph bounds, typecheck, lint, unit tests, build, independent reviews
  risks: receipt replay, delayed upload, invalid receipt fallback, registration retries and changed payloads
invariants: [I-03, I-05a, I-22, I-28, I-31, I-33, I-34, I-35, I-45a, I-50]
p1: []
tickets: []
---
P-23 specification only; review pending.
