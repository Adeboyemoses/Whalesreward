---
branch: core/wo-9b-review-evidence-operator
linear: WHR-114
tier: high
reviewed_head: 568c8227e6e9368fc141c14c934844a2f4b4509a
rounds: 1
builder: platform-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 5
plan:
  goal: Provide an Earl-run dry-run-first activation and deactivation command with no secret output.
  files: scripts/ops/**, package.json, tests/unit/review-evidence-operator.test.ts, tests/integration/review-evidence-operator.test.ts, docs/ops/review-evidence.md
  approach: Validate explicit inputs and built-in digest; verify database environment; lock scope before reading both revision histories; use bound inserts in one transaction; print exact policy and manual next steps.
  tests: Real PostgreSQL dry run, atomic apply and rollback, ordering and overflow, digest/environment refusals, concurrent activation/deactivation, CLI validation and secret-safe failures.
  risks: Database environment authority must resolve WHR-116; inactive policy follows M3 null approval/time semantics; concurrency shares the existing acceptance lock; no managed deployment changes.
invariants: [I-26, I-35, I-41]
p1: []
tickets: []
---

## Implementation sequence

- Add failing parser/output tests, then strict activate/deactivate CLI parsing, default dry run and explicit --apply. Reject unknown/duplicate flags, missing authorization, malformed scope/instant/digest and conflicting modes. Never echo unvalidated input or raw errors.
- Add failing real-Postgres transaction tests, then scope serialization using the existing review-evidence advisory lock before max revision lookup. Consider both immutable tables so orphan approvals cannot reuse revisions. Enforce safe integer bounds. Activation inserts approval plus configuration atomically; deactivation appends inactive configuration as specified by M3.
- Validate environment against a database-held authority after WHR-116 resolves; no CLI/environment fallback may establish database identity. Use a read-only transaction for preview; do not simulate writes or invoke insert triggers in dry run.
- Exercise parallel activation/deactivation, forced second-insert failure, stale-preview revision changes, malformed arguments and child-process error output. Tests use disposable local Postgres only.
- Update the runbook with exact invocation, secret-safe shell setup, preview versus applied IDs/revision, and manual policy-setting/admin health checks. Record that this command does not deploy or activate an application setting itself.
- EM reruns typecheck, lint, unit, build and full integration; code/security/integrity review the committed diff within three rounds. Commit evidence separately and merge only with required CI green.

## Verification and review

WHR-116 resolved by Earl on 12 Nov: persisted database-level identity only; no session/role override.
Both builder dispatches completed; all three independent reviewers PASS round 1, no findings.
EM typecheck, lint (two existing image warnings), 689 unit tests, build and 699 PostgreSQL tests PASS.
Targeted CLI/transaction coverage: 11 unit and 11 real-Postgres tests, independently rerun by reviewers.
Apply requires the authorized expected revision; previews reserve neither revision nor UUIDs.
No managed environment, public endpoint, policy deployment or purchase/hold mutation performed.
