---
branch: spec/WHR-139-stuck-holds
linear: WHR-139
tier: high
reviewed_head: pending
rounds: 0
builder: spec-em
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Specify the narrow Q-557 two-person release exception with explicit pending recommendations
  files: docs/engineering/contracts/m3.md, docs/engineering/contracts/m3-audit-inventory.md, docs/engineering/proposals/evidence-policy.md, docs/engineering/decisions/INDEX.md
  approach: Preserve v1 and P-26, add guarded attested proposal and independent decision, protected immutable provenance and activation gate
  tests: Independent code security integrity review, scope and link checks, typecheck lint unit tests build and evidence validator
  risks: Self approval, evidence substitution, stale history, double credit, finalization races and mistaken activation
invariants: [I-05a, I-07, I-22, I-25, I-26, I-28, I-31, I-33, I-34, I-35, I-41, I-45a, I-46, I-48, I-51]
p1: []
tickets: []
---
Plan only; verdicts pending. No code or runtime activation. Earl explicitly excludes STATUS, coverage-map and lane edits.
