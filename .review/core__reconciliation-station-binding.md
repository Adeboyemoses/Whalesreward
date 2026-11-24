---
branch: core/reconciliation-station-binding
linear: WHR-229
tier: high
reviewed_head: c777b1af475aa25f2249e26026b61e02edb9f7c7
rounds: 1
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 4
plan:
  goal: Bind every station to the exact approved reconciliation-v1 definition.
  files: prisma/migrations/**, tests/integration/**, tests/helpers/**, tests/e2e/**
  approach: Follow P-28 with guarded idempotent existing-station backfill and new-station trigger; seed only bindings.
  tests: Real PostgreSQL upgrade and fresh station, repeat migration, definition guard negatives, real HTTP health and checklist without fixture binding; full required gates.
  risks: Never overwrite immutable existing policy bindings or configure an unsupported definition; preserve campaign and checklist state.
invariants: [I-07, I-45, I-46]
p1: []
tickets: [WHR-221]
---

WHR-229 escaped through fixture-only station bindings. Removing those inserts first reproduced reconciliation_policy_unconfigured; the migration restored census validation.
The migration locks station creation, validates the approved definition, backfills only missing bindings and installs guarded triggers atomically. Replays preserve immutable bindings.
Seven upgrade/idempotence/definition-guard tests and six real PostgreSQL/socket HTTP tests cover protected/public health, readiness, checklist, census and certification without fixture bindings.
All three independent reviewers passed the exact code head in round one with no findings; each independently ran the 13 new tests successfully. Worktree remained clean and head unchanged during review.
EM typecheck, lint (four existing image warnings), unit (1046), build and identifier guard (26) passed. Full integration verification is recorded in the PR.
The local full run hit the existing WHR-221 P-27 token-refill timing flake; the complete P-27 file passed 18/18 on focused rerun. The photo-receipt suite rejected the task-specific database name and passed 7/7 against a fresh allowed disposable database. No assertions or guards were weakened; CI integration must pass before merge.
Local Playwright was attempted but Chromium cannot launch under the macOS sandbox (MachPortRendezvousServer permission denied); required CI browser checks must pass before merge.
Sweep: campaign timing already has migration/backfill/triggers; review-evidence and meter have production operator writers; canonical people have ops:person from WHR-227. No other migrated-definition/fixture-only-station-binding gap found.
No campaign values, people or checks are seeded. Per Earl, no STATUS, coverage-map or lane-file edits.
