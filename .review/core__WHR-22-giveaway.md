---
branch: core/WHR-22-giveaway
linear: WHR-22
tier: high
reviewed_head: 6cd0870
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Exact leaderboards and immutable audited giveaway finalization under P-30
  files: prisma/**, src/server/**, src/shared/**, src/app/api/**, tests/**
  approach: Shared exact contribution evaluator and generation locks across all writers; versioned phone census and two-person exclusions; immutable previews and numbered snapshots
  tests: M4 downstream PostgreSQL verification including SR-06 initial revision unchanged reconciliation and concurrent writer races; full repository gates
  risks: Phantom intake and lineage changes must invalidate previews; phone exclusions must not suppress other blockers; no policy activation or seeded campaign values
invariants: [I-11, I-14, I-40, I-41, I-42, I-43, I-44, I-45, I-45a, I-46]
p1: []
tickets: []
---
Implementation plan follows the approved M4 contract through WO-spec-4c.
No STATUS, coverage-map or lane changes belong in this feature PR.
