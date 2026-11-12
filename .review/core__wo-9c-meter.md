---
branch: core/wo-9c-meter
linear: WHR-126
tier: high
plan:
  goal: Implement correct_meter exactly per P-26 with immutable provenance and fail-closed approved profiles.
  files: prisma/**, src/server/modules/reviews/**, src/server/modules/health/**, src/shared/contracts/**, scripts/ops/**, package.json, tests/**, docs/ops/**
  approach: Extend the P-25 locked resolver and existing price decision transaction; exact rational comparison, immutable approved profile/configuration versions and evaluation snapshots; operator dry-run/apply follows WHR-114.
  tests: Real PostgreSQL MR-T1-01 through MR-T1-20 including both boundary sides, profile lifecycle races, independent holds, replay, authorization, provenance and health privacy; full required gates.
  risks: Schema and acceptance changes must preserve originals and candidates, serialize policy/history state, retain permission conjunction and independence, and never seed real profiles before Q-559.
invariants: [I-07, I-09, I-22, I-26, I-29, I-31, I-35, I-39, I-41, I-42, I-46, I-48]
---

Implementation follows the normative P-26 section and its exact twenty-case table in docs/engineering/contracts/m3.md, with operations.md meter readiness. No STATUS, coverage or lane edits. No UI changes or real profile values.

1. Add strict profile/policy validation, immutable verification/approval/configuration/evaluation persistence and reviewed SQL constraints. Pin installed artifact and P-25 dependency; reject absent or invalid coverage.
2. Extend correct_meter within existing authorization, evidence, idempotency and transaction boundaries. Preserve submitted strings and original facts; compare unrounded rational residual/allowance and retain the staged candidate through other holds.
3. Add read-only configuration health coverage and a bound-parameter operator command with default dry run, explicit apply, environment checks, monotonic immutable revisions and runbook.
4. Map each MR-T1 case to named real-Postgres tests, including negative rollback assertions and exact provenance reconstruction. Run complete gates, then independent code/security/integrity review within three rounds.
