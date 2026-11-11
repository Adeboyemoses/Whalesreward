---
branch: core/WHR-111-review-evidence
linear: WHR-111
tier: high
reviewed_head: pending
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: implement normative review-evidence-v1 and protected reviewEvidence health status
  files: prisma/**, src/server/**, src/shared/**, src/app/api/**, scripts/**, tests/**, docs/ops/**
  approach: fixed bounded resolvers and immutable release artifact; scoped append-only policy approvals and revisions; pin and serialize policy/history through decision commit; protected atomic evaluation provenance
  tests: real-Postgres RE-01 through RE-21 from amended m3 including equality boundaries, invalid histories, cycles, authority, deactivation races, replay and health privacy
  risks: evidence must never create facts or bypass independent gates; rollout remains inactive until Earl provisions approved configuration
invariants: [I-07, I-09, I-22, I-26, I-31, I-33, I-34, I-35, I-39, I-41, I-45a, I-46]
p1: []
tickets: []
---
Plan committed before builders. Price cancel and correct_meter stay refused. No cloud, STATUS, coverage or lane changes.
