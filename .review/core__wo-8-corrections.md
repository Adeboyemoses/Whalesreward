---
branch: core/wo-8-corrections
linear: WHR-14
tier: high
reviewed_head: 0000000
rounds: 1
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: implement approved P-22 numeric corrections, durable midnight classification, independent late review and scoped M3 sales reads
  files: prisma/**, src/server/**, src/shared/**, src/app/api/**, src/instrumentation.ts, jobs/**, tests/**, docs/qa/**
  approach: reserve immutable correction and first receipt before validation; serialize live authority and purchase guards; apply one accepted contribution or retain review/holds; bind all evidence and projections to the original sale
  tests: exact Lagos midnight and cross-midnight retries; stale/concurrent/cancel guards; P-19 approve/reject/replay exclusions; exact totals and retained holds; read/photo privacy; crash/restart and revocation during validation
  risks: no invented sale date or renewed window; retained validated photo only; no replacement of original capture facts; integrate merged WHR-84 before sign-off; recovery intake and hold/duplicate decisions remain future work
invariants: [I-07, I-09, I-22, I-26, I-28, I-29, I-35, I-37, I-38, I-39, I-41, I-42, I-44, I-45a, I-48, I-50, I-52]
p1: []
tickets: []
---
Plan committed before builder dispatch. Implementation and independent review pending.
WHR-47 Option A/P-22 is approved in the current session; WHR-84 owns the parallel
contract amendment. The merged amendment is a required input before final review.
WHR-80 and WHR-12 remain In Review; batched smoke is not acceptance.
