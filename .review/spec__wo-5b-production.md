---
branch: spec/wo-5b-production
linear: WHR-186
tier: high
reviewed_head: 0000000
rounds: 1
builder: spec-em
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Specify recoverable production operations and explicit launch decisions for WHR-29 and WHR-31
  files: docs/ops/production.md, docs/engineering/contracts/operations.md, docs/engineering/decisions/INDEX.md, docs/engineering/decisions/technical.md
  approach: Ground eight operational areas in approved contracts, separate recommendations from activation, preserve all evidence, and enumerate owner/default gates
  tests: Source and scope audit, typecheck, lint, unit tests, build, three independent specification reviews, evidence validator
  risks: Incomplete database-photo recovery, silent policy gaps, incompatible activation, secret loss on spec reapply, or accidental retention authority
invariants: [I-22, I-25, I-26, I-28, I-41, I-45, I-46, I-49]
p1: []
tickets: []
---
Plan committed before specification changes and independent review.
