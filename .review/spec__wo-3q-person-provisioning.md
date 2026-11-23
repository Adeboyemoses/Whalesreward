---
branch: spec/wo-3q-person-provisioning
linear: WHR-222
tier: high
reviewed_head: 0bccb61
rounds: 1
builder: spec-em
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: specify private operator provisioning for canonical people without runtime activation
  files: docs/engineering/contracts/person-provisioning.md, docs/engineering/contracts/m3.md, docs/ops/person-provisioning.md, docs/engineering/decisions/INDEX.md, docs/engineering/decisions/technical.md
  approach: append-only bindings and scoped revision guard, fail-closed identity, explicit downstream invalidation and fictional walkthrough
  tests: source trace, Markdown links, diff check, typecheck lint unit build and three independent spec reviewers
  risks: alias self-approval, stale proposals and phone evidence, operator target confusion, private identity disclosure
invariants: [I-07, I-09, I-35, I-41, I-46]
p1: []
tickets: [WHR-223, WHR-224, WHR-225]
---
Plan committed before drafting and independent review. Specification only; no data operations.
