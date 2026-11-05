---
branch: core/wo-4-sync
linear: WHR-6
tier: high
reviewed_head: 4053b16134b04a200dabef5c42d95f36a636666a
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 10
invariants: [I-03, I-05a, I-06, I-09, I-17, I-22, I-25, I-26, I-27, I-28, I-29, I-31, I-48, I-50]
p1: ["fixed finalize operation scope in original revision identity", "fixed complete price snapshot validation"]
tickets: []
plan:
  goal: implement M1 lookup, durable sync and exactly-once evidence-backed credit with P-18
  files: src/server/modules/sync/**, src/server/adapters/storage*, src/shared/contracts/sync*, src/app/api/**, prisma/**, jobs/orphans.ts, tests/**, package.json, pnpm-lock.yaml, docs/qa/**, docs/engineering/coverage-map.md
  approach: preserve original receipt and context; evaluate bounded history in one policy module; validate staged bytes into immutable final storage; atomically claim revision and audit with live authority checks
  tests: real PostgreSQL lost-response retry, concurrent finalize and adversarial staging overwrite; P-18 boundaries, isolation, metadata and decode limits; MinIO and Spaces-compatible signing
  risks: storage and database cannot commit together; history uncertainty must hold without credit; additive schema and signing must preserve replay and immutable evidence
---

M1 lookup/sync and immutable validated evidence implement the committed plan.
Round1 found signed PUT size bypass (SEC-HIGH), truncated P-18 timestamps (INTEGRITY-P1), finalize-key scope collision and incomplete captured-rate validation (P1).
Exact immutable ContentLength is now signed; browser supplies it automatically with only Content-Type authored.
P-18 receives exact PostgreSQL epoch microseconds and compares BigInt; SQL history cutoffs use the stored receipt directly.
Original revision identity uses the original operation; finalize receipts keep purchase-scoped keys. Full price snapshots return bounded calculation errors.
Independent tests first reproduced all findings; six new PostgreSQL/MinIO regressions then passed. Actual Chromium Blob upload and wrong-length rejection passed.
All three reviewers PASS at4053b16 in round2. EM checked clean tree and unchanged HEAD after each round.
Detailed policy blocks remain separate from holds and project M1 policy_review_required (WHR-59 resolved from existing M3 text, no new policy).
MinIO tests plus Spaces signing checks establish adapter behavior; live authenticated Spaces/phone smoke is separate and not claimed. No cloud operations.
Dispatch flag10>8 recorded in lane file; rounds2 within cap3. Final EM outputs and green CI/merged PR are pasted on WHR-6 before READY.
