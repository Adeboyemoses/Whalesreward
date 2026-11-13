---
branch: spec/wo-4a-m4
linear: WHR-133
tier: high
reviewed_head: pending
rounds: 1
builder: spec-em
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Reconcile M4 through P-27 and prepare client decisions without activating policy
  files: docs/engineering/contracts/m4.md, docs/engineering/proposals/m4-client-decisions.md
  approach: Amend normative totals, provenance, statuses, health and audit; isolate proposed choices and downstream gaps
  tests: EM typecheck lint unit build; source cross-checks, links and paragraph bounds; independent three-role review
  risks: Incorrect membership or audit inheritance could miscount sales or leak protected provenance; unresolved policies stay blocked
invariants: [I-22, I-28, I-35, I-40, I-41, I-42, I-43, I-44, I-45, I-45a, I-46, I-51]
p1: []
tickets: []
---
Plan committed before drafting. Specification only; no runtime or policy activation claim.
