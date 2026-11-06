---
branch: spec/wo-2a-offboarding
linear: WHR-79
tier: high
reviewed_head: d392a7165e54fc03e384fe0943b1ddee176fc6de
rounds: 2
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
plan:
  goal: specify assignment-ending offboarding under P-21 without application code
  files: docs/engineering/contracts/m1.md, docs/engineering/contracts/m2.md, docs/engineering/contracts/m3.md, docs/engineering/data-model.md, docs/engineering/decisions/INDEX.md
  approach: guarded idempotent assignment end with atomic live-authority revocation and immutable P-20 queue history
  tests: EM typecheck lint unit build and spec consistency checks; independent code security integrity review
  risks: offline phones cannot observe revocation instantly; implementation is separate core work; shared READY records follow in a separate PR
invariants: [I-01, I-03, I-04, I-05, I-05a, I-06, I-07, I-09, I-22, I-28, I-35, I-36, I-41, I-45a]
p1: [fixed M3 assignment-ended audit action target and exact typed changes]
tickets: []
---
Approved WO-spec-2a scope and Earl's WHR-76 decision; specification only.
Round 1 found the new ending audit absent from M3's closed catalogue.
Round 2: all three independent reviewers PASS at d392a716.
EM typecheck, lint, 248 unit tests and production build PASS.
Added prose <=120 words, local file link targets and diff whitespace PASS.
No runtime, migration, new automated invariant coverage or board parity claimed.
WHR-80 tracks the separate core implementation; shared READY records follow separately.
