---
branch: core/WHR-227-person
linear: WHR-227
tier: high
reviewed_head: a807d267991c1fe63094ca02f05f6cf5058de626
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 15
plan:
  goal: Provide accountable canonical-person provisioning and safe stale-proposal rejection under WHR-223 through WHR-225 Option A.
  files: scripts/ops/person.mjs, package.json, prisma/**, src/server/modules/audit/**, src/server/modules/reviews/**, src/server/modules/giveaway/**, src/server/modules/admin-access/**, scripts/ops/review-evidence.mjs, tests/**, docs/ops/person-provisioning.md, docs/engineering/contracts/person-provisioning.md
  approach: Follow the approved person-provisioning contract; append immutable ledger and binding rows under security-state then provisioning/reporting/campaign locks; invalidate live giveaway generations and manager pointers; use immutable proposer and historical alias exclusions for rejection only.
  tests: Red-green operator validation and PostgreSQL lifecycle tests; non-superuser immutable guards and races; provisioned all-enabled-account installation and giveaway reads; stale P-29 and phone rejection via real HTTP; alias fences; rebind versus pending proposal; disable versus designation; full typecheck lint unit build integration and e2e gates.
  risks: Additive immutable ledger migration; lock-order correctness; audit redaction; never rebase approvals or mutate frozen history; uncertain commits require exact-revision reconciliation.
invariants: [I-07, I-09, I-26, I-35, I-41, I-46]
p1: ["fixed obsolete sheet reservation reuse with immutable binding pins and fresh-use checks while retaining historical receipts"]
tickets: []
---
Canonical-person operator provisioning implements Earl's WHR-223–225 Option A decisions.
Immutable ledger children retain exact binding and campaign provenance; evidence references stay outside general audit.
Conservative identity invalidation preserves pending blockers, approved history and frozen snapshots.
Round 1 found one P1: same-person reverification could reuse an old paper upload. Round 2 passed the immutable reservation-pin fix and its six PostgreSQL regressions.
EM final source gates: typecheck, lint (four existing image warnings), 1,046 unit tests, 1,613 PostgreSQL tests, production build and identifier guard PASS. Both timezone runs passed five tests each.
Non-superuser PostgreSQL and real HTTP cover aliases, stale rejection, replay, rollback, uncertain commits and races with designation, policy activation and giveaway confirmation.
Local Chromium launch is blocked by the macOS Mach-port sandbox; the required CI browser job must pass before merge.
Dispatch flag: daemon recovery and fix verification raised dispatches above eight; review rounds remained within the cap of three.
No STATUS, coverage-map or lane files are included. Staging execution remains Earl-run from docs/ops/person-provisioning.md.
