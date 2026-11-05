---
branch: core/wo-5-admin-access
linear: WHR-8
tier: high
reviewed_head: 5397551d03833bb0d852ef6c47448dc7f71ac1be
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 9
p1: ["fixed role-list SQL binding and worker exhaustion in 5397551 with four red-to-green PostgreSQL regressions"]
tickets: []
plan:
  goal: Implement m2 admin access, 28 action permissions, roles and verified-email recovery for WO-core-5.
  files: prisma/**, src/server/lib/**, src/server/modules/admin-access/**, src/server/adapters/**, src/app/api/admin/**, src/shared/contracts/**, tests/**, jobs/**, docs/ops/staging.md, docs/qa/**
  approach: Reuse Better Auth identities and database sessions; central authz and serialized security lock protect live grants, delegation and last Owner; hashed purpose-bound challenges and asynchronous adapter mail protect recovery.
  tests: Permission denial and surface isolation, first-password enforcement, subset delegation, concurrent last-Owner changes, token expiry/replay/generation, reset revocation, idempotency and privacy; full EM gates on final head.
  risks: Additive schema only; proposed WHR-42/43 policy isolated and production fails closed; no provider activation or staging data change; no shared records in feature PR.
invariants: [I-07, I-08, I-09, I-10, I-11, I-12, I-13, I-41]
---

Approved implementation scope is docs/engineering/contracts/m2.md through admin users and roles; station, cards, attendants and UI are excluded.
Backend builder owns implementation, migrations, focused tests and staging-seed documentation. Test engineer independently adds real-Postgres adversarial coverage after the API is available.
Local Mailpit and staging no-op adapter only. Production policy and delivery remain disabled pending approval. Staging insert-only admin credential is an Earl-run data step, never executed by this session.

All three independent reviewers passed round 2 at the reviewed head; worktree stayed clean and unchanged after both rounds.
Round 1 found two P1s: extra SQL binding broke authorized role listings; false worker exhaustion stranded later recovery work. Both fixed; four regressions failed before and passed after.
EM final-head verification: typecheck/lint/build PASS; unit 140 (23 files), PostgreSQL/MinIO integration 129 (7 files), including 25 named access adversarial tests.
Native Chromium was blocked by the macOS sandbox. EM reran the exact source in an isolated local Linux container with pinned Node: browser 68 passed, four existing staging-only skips, zero failures/retries.
Mailpit adapter delivery verified locally. Two additive forward migrations preserve prior guards/history; no production policy activation, cloud operation or staging data change.
Feature contains no STATUS, coverage or lane changes. Nine feature dispatches exceed the high-tier dispatch flag; review rounds remain within cap 3.
