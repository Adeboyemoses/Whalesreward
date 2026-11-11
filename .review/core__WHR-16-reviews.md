---
branch: core/WHR-16-reviews
linear: WHR-16
tier: high
reviewed_head: pending
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: implement P-24 advisory duplicates and evidence-bound independent review decisions
  files: prisma/**, src/server/**, src/shared/**, src/app/api/**, jobs/**, tests/**
  approach: durable bounded duplicate intents and atomic guarded decisions using shared security/reporting/purchase locks and staged candidates
  tests: real-Postgres coverage of applicable m3 Required downstream verification bullets, permissions, replay, races, evidence and resolution order
  risks: duplicate cancellation removes credit; evidence and staged candidates must not bypass independent gates
invariants: [I-22, I-26, I-31, I-33, I-34, I-35, I-40]
p1: []
tickets: []
---
Implementation plan recorded before builder dispatch. No STATUS, coverage or lane edits.
