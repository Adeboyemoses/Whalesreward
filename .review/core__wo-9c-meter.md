---
branch: core/wo-9c-meter
linear: WHR-126
tier: high
reviewed_head: 696da8159d90c9ad9895f7716b4dc33b8c38c9ea
rounds: 2
builder: backend-engineer + platform-engineer + test-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 12
plan:
  goal: Implement correct_meter exactly per P-26 with immutable provenance and fail-closed approved profiles.
  files: prisma/**, src/server/modules/reviews/**, src/server/modules/health/**, src/shared/contracts/**, scripts/ops/**, package.json, tests/**, docs/ops/**
  approach: Extend the P-25 locked resolver and existing price decision transaction; exact rational comparison, immutable approved profile/configuration versions and evaluation snapshots; operator dry-run/apply follows WHR-114.
  tests: Real PostgreSQL MR-T1-01 through MR-T1-20 including both boundary sides, profile lifecycle races, independent holds, replay, authorization, provenance and health privacy; full required gates.
  risks: Schema and acceptance changes must preserve originals and candidates, serialize policy/history state, retain permission conjunction and independence, and never seed real profiles before Q-559.
invariants: [I-07, I-09, I-22, I-26, I-29, I-31, I-35, I-39, I-41, I-42, I-46, I-48]
p1: ["fixed P-26 numeric domain errors to return 422 calculation_invalid with HTTP rollback regressions"]
tickets: [WHR-131]
---

Implementation follows the normative P-26 section and its exact twenty-case table in docs/engineering/contracts/m3.md, with operations.md meter readiness. No STATUS, coverage or lane edits. No UI changes or real profile values.

1. Add strict profile/policy validation, immutable verification/approval/configuration/evaluation persistence and reviewed SQL constraints. Pin installed artifact and P-25 dependency; reject absent or invalid coverage.
2. Extend correct_meter within existing authorization, evidence, idempotency and transaction boundaries. Preserve submitted strings and original facts; compare unrounded rational residual/allowance and retain the staged candidate through other holds.
3. Add read-only configuration health coverage and a bound-parameter operator command with default dry run, explicit apply, environment checks, monotonic immutable revisions and runbook.
4. Map each MR-T1 case to named real-Postgres tests, including negative rollback assertions and exact provenance reconstruction. Run complete gates, then independent code/security/integrity review within three rounds.

Round 1: security and integrity PASS; code found one P1: well-formed nonpositive/overflow meter values incorrectly returned 400. Commit 696da81 separates syntax from numeric domain checks after authority/replay and before no-change arithmetic. Eight real-HTTP red cases became green, with malformed inputs retaining 400 and no mutation on rejection. Round 2: all three reviewers PASS without findings at the recorded head. Worktree and head remained unchanged throughout both reviews.

Independent reviewer checks: round 1 code 94 PostgreSQL, security 116 PostgreSQL, integrity 155 PostgreSQL; round 2 code 31 units, security 26 units, integrity 26 units plus 94 PostgreSQL. Full EM verification is recorded in the PR and Linear READY message. The native browser cannot launch inside the macOS sandbox; passing CI e2e is required before merge.

The native operator CLI reuses the reviewed TypeScript policy schemas. The one-line allowImportingTsExtensions setting under existing noEmit is necessary wiring, reconciled with the plan during code review; no dependency or runtime policy is added by that setting.

MR-T1-01–20 mapping is in tests/integration/meter-matrix.md and meter-adversarial-matrix.md. Visual display recognition remains the authorized human's duty and Q-559 pilot prerequisite under the approved proposal, not an OCR claim. The future recovered-original transport is not claimed as an implemented end-to-end test. WHR-131 records that coverage clarification. No real profiles, activation, cloud action or shared-record edits are included.

Dispatch flag: 12 exceeds the high-tier advisory threshold of 8; review rounds remain 2 of the cap of 3. Extra dispatches covered split operator/tests, test planning, a health snapshot consistency fix and the scalar error-contract fix. No escalation or review bypass occurred.
