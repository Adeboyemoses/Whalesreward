---
branch: core/WHR-227-person
linear: WHR-227
tier: high
reviewed_head: 8e7e323
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Provide accountable canonical-person provisioning and safe stale-proposal rejection under WHR-223 through WHR-225 Option A.
  files: scripts/ops/person.mjs, package.json, prisma/**, src/server/modules/audit/**, src/server/modules/reviews/**, src/server/modules/giveaway/**, src/server/modules/admin-access/**, scripts/ops/review-evidence.mjs, tests/**, docs/ops/person-provisioning.md, docs/engineering/contracts/person-provisioning.md
  approach: Follow the approved person-provisioning contract; append immutable ledger and binding rows under security-state then provisioning/reporting/campaign locks; invalidate live giveaway generations and manager pointers; use immutable proposer and historical alias exclusions for rejection only.
  tests: Red-green operator validation and PostgreSQL lifecycle tests; non-superuser immutable guards and races; provisioned all-enabled-account installation and giveaway reads; stale P-29 and phone rejection via real HTTP; alias fences; rebind versus pending proposal; disable versus designation; full typecheck lint unit build integration and e2e gates.
  risks: Additive immutable ledger migration; lock-order correctness; audit redaction; never rebase approvals or mutate frozen history; uncertain commits require exact-revision reconciliation.
invariants: [I-07, I-09, I-26, I-35, I-41, I-46]
p1: []
tickets: []
---
Pre-dispatch plan. Earl directly commissioned WHR-227 and specified the command, policies, verification and merge scope.

1. Backend builder owns CLI, package entry, additive ledger/child schema and audit allowlists, provisioning invalidation and activation lock participation. Test strict inputs, comment identity, previews/list, immutable revisions, concurrency, rollback and reconciliation.
2. Runtime builder owns release-people.ts, release-service.ts, phones.ts and access invalidation. Preserve approval checks; reject stale proposals under current authority using immutable and historical/current identity exclusions. Test both preflight and commit.
3. Test engineer owns additional provisioned-data integration/HTTP tests, independent of direct binding fixtures. Prove installation, selections, alias denials and rebind/disable races using non-superuser PostgreSQL.
4. EM finalises runbook and command naming in contract, integrates builder commits, runs final gates, dispatches code/security/integrity reviewers (cap 3), commits validated evidence, opens and merges staging PR when green, reports READY and stops.

No STATUS, coverage-map or lane-file edits in this feature PR. No deployed data/configuration changes.
