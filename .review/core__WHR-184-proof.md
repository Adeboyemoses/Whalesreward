---
branch: core/WHR-184-proof
linear: WHR-184
tier: high
reviewed_head: pending
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: preserve bound P-29 campaign proof through contribution reads and snapshots
  files: src/server/modules/reviews/**, src/server/modules/giveaway/**, tests/**, docs/engineering/contracts/**, docs/qa/**
  approach: reproduce through HTTP then share a typed provenance schema across writers and reader while retaining purchase decision station evidence revision version and campaign settings bindings
  tests: real PostgreSQL and storage HTTP sheet reserve PUT finalize proposal independent approval both leaderboard bases readiness reconciliation snapshot sources; outside foreign campaign settings policy-off replay later correction; card date price targets
  risks: accepting foreign or stale provenance can misrank spend; retained historical proof must survive policy-off replay and valid later numeric correction without rewriting originals or snapshots; no policy activation
invariants: [I-07, I-25, I-26, I-28, I-31, I-33, I-34, I-35, I-42, I-43, I-45, I-45a, I-46]
p1: []
tickets: []
---
Plan committed before builder dispatch. Earl commissioned the bounded fix on 18 Nov
and explicitly authorized its implementation and staging merge in this session.
