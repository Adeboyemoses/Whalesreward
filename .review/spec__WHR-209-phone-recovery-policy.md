---
branch: spec/WHR-209-phone-recovery-policy
linear: WHR-209
tier: high
reviewed_head: a83d6fb
rounds: 0
builder: spec-em
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: specify approval-gated OTP and independently proven original-phone recovery
  files: docs/engineering/contracts/m3.md, docs/engineering/contracts/operations.md, docs/engineering/decisions/INDEX.md, docs/engineering/decisions/technical.md
  approach: preserve built HMAC and atomic semantics; recommend bounded delivery and enrolled device proof; separate policy readiness from runtime activation
  tests: EM typecheck lint unit build; document links and scope checks; independent code security integrity review
  risks: SMS pumping and duplicate dispatch; cloned device identifiers; queue loss; recommendations mistaken for approval
invariants: [I-06, I-07, I-09, I-19, I-21, I-22, I-26, I-33, I-36, I-41]
p1: []
tickets: []
---
Plan recorded before drafting. Review verdicts pending; this is not merge evidence yet.
