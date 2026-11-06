---
branch: core/wo-6-station
linear: WHR-10
tier: high
reviewed_head: 6072636
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: implement M2 pumps, immediate immutable product prices, attendant provisioning and assignment handover
  files: prisma/**, src/shared/contracts/**, src/server/**, src/app/api/**, tests/integration/**
  approach: reuse live admin security locking and durable receipts; serialize product activation and assignment changes; preserve capture contexts
  tests: real PostgreSQL races, replay and stale versions, first-password restriction, old queue history and P-20 changes inside/outside capped interval
  risks: additive schema and restricted first-password sessions; no history rewrite or stale authority at commit; disputed status operations await Earl
invariants: [I-01, I-04, I-05, I-05a, I-07, I-09, I-29, I-31, I-32, I-41]
p1: []
tickets: []
---
Plan saved before builder dispatch. No completed review or verification is claimed.
