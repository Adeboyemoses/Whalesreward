---
branch: core/wo-7b-card-runtime
linear: WHR-97
tier: high
reviewed_head: df797f37a77e3fa5942b160992619a444c06f693
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 9
plan:
  goal: establish and fix the cause of platform failures during card generation and export preparation
  files: src/server/modules/cards/**, src/server/adapters/card-*, src/server/lib/db*, src/server/lib/transaction*, src/server/modules/admin-access/repo.ts, src/server/modules/auth/**, src/server/modules/sync/repo.ts, tests/**, scripts/**, docs/qa/**
  approach: prove hung storage lock contention; move storage outside transactions with fenced publication and live authorization rechecks; bound storage and database waits with shared safe transaction cleanup across request-pool consumers
  tests: hung storage red-green regression, responsive admin requests, retryable exports, bounded JSON errors, revocation and stale leases, production reproduction and all repository gates
  risks: process exhaustion, lock contention, slow storage, lease fencing and immutable reserved codes; cloud changes belong to Earl
invariants: [I-07, I-09, I-16, I-18, I-20, I-41, I-52]
p1: []
tickets: []
---
Hung storage held the global security lock and blocked independent admin reads; the red regression failed on that blocked read.
Storage now runs outside transactions with five-second whole-operation deadlines and fresh authority/fenced publication checks.
Request database waits are bounded; all four transaction consumers share safe timeout cleanup.
Round 1 code review found a P0 in older auth/rate-limit/sync timeout cleanup and a P2 diagnostic timing error. Both fixed in df797f3; round 2 all PASS.
Code and integrity reviewers independently passed eight real transaction-timeout regressions; security independently passed ten storage tests in round 1.
EM final-head checks: typecheck, lint, unit 529/529, production build, integration 390/390 PASS.
Linux production browser suite: 236 passed, four existing staging-only skips, zero retries (4.6 minutes).
Final production export matrix: 6/6 PASS (31.8 seconds), 1 GiB container, one CPU, 128 MiB V8 heap; three observed pools explicitly max=2.
Hung upload/download, ignored-abort late completion, revocation/lease expiry, stalled HTTP body, JSON 503 lock/acquisition errors and recovery covered.
Historical edge logs are unavailable; local reproduction establishes the blocking mechanism consistent with Earl's flat memory/CPU Insights.
Dispatch flag: nine calls exceeds the high-tier eight-call flag; two review rounds remain within cap three. No lane edit per Earl's explicit instruction.
No cloud, client-message, STATUS, coverage or lane changes. Smoke: docs/qa/smoke-2026-11-10-card-runtime.md.
