---
branch: core/WHR-164-release-discovery
linear: WHR-164
tier: high
reviewed_head: ade42769f52a24d33fc44fac539a381f97ff8aaa
rounds: 3
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 17
plan:
  goal: Implement T-20 protected release preparation and complete authorized pending discovery without activation.
  files: src/shared/contracts/**, src/server/modules/**, src/app/api/admin/**, tests/**, prisma/migrations/** only if an index is necessary
  approach: Factor common structural classification from release admission; reuse guarded candidate and policy/history/security locks; project safe admin summaries; query persisted pending state with scoped authenticated tuple cursors and snapshot after first-page serialization lock.
  tests: Named real-Postgres RD-01 through RD-06 covering exact context and targets, classification, interleavings, over-100 precision paging, per-kind access and cursor changes, giveaway blockers and read-only state; non-superuser permission tests; typecheck, lint, unit, build, integration and relevant browser/time gates.
  risks: Protected evidence leakage, drifting snapshots, commit-order paging gaps, mutation regression, admission mistaken for credit; keep v2 unconfigured and use disposable local databases only.
invariants: [I-07, I-09, I-26, I-31, I-33, I-34, I-35, I-41, I-45, I-46, I-48]
p1: [fixed global structural exclusion precedence, fixed ordinary price outcome classification, fixed candidate and history interleavings, fixed distinct changed and unchanged giveaway verification]
tickets: []
---

Plan committed before builder dispatch. RD-07 belongs to the later app work order.
All three independent reviewers passed round three at reviewed_head; clean worktree and unchanged head confirmed after every round.
Fixed strict query-key handling, global negative-reason precedence, lawful ordinary-price classification, and preparation's two-verified-admin minimum.
Added real candidate/history races, missing-profile cases, changed/unchanged giveaway controls and constraint-valid fixture repairs.
Preserved WHR-153 mutation rejection codes while retaining T-20's advisory structural classification; the existing SR-01 assertion stays unchanged.
EM typecheck, lint (two existing warnings), 966 unit tests, production build and five time tests in each timezone passed on reviewed_head.
Local PostgreSQL is unavailable (Docker socket timeout; native shared memory denied). Isolated CI PostgreSQL and browser gates must pass before merge; no unperformed runtime pass is claimed here.
Dispatch flag exceeded (17): parallel builders, targeted test repairs and three three-reviewer rounds. Review cap is three; no escalation or bypass.
No runtime activation, real database or cloud operations; no STATUS, coverage-map or lane-file changes.
