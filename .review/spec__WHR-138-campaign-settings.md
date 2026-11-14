---
branch: spec/WHR-138-campaign-settings
linear: WHR-138
tier: high
reviewed_head: 0000000
rounds: 1
builder: spec-em
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: specify Owner-only campaign setup and pre-start timing changes under P-28
  files: docs/engineering/contracts/m4.md, docs/engineering/contracts/operations.md, docs/engineering/data-model.md, docs/engineering/decisions/INDEX.md
  approach: extend giveaway review-confirm for create and update, record approved policy identity, preserve locks and history, ground impact notes in PRs 135 and 138
  tests: final-head typecheck, lint, unit tests, build, documentation consistency and evidence validation
  risks: concurrent creation, old-start lock bypass, replay authority, stale policy or eligibility lineage, retention contamination
invariants: [I-07, I-09, I-41, I-45, I-45a, I-46, I-51]
p1: []
tickets: []
---
Specification only. Review verdicts pending; this file does not authorize merge.
