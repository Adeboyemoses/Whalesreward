---
branch: core/WHR-210-report-jobs
linear: WHR-210
tier: high
reviewed_head: 76fb61bd04d6e4d4b695834806cc81112789183c
rounds: 3
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 13
plan:
  goal: leased bounded resumable report-only orphan and upload reconciliation jobs
  files: jobs/orphans.ts, jobs/reconcile-uploads.ts, src/server/modules/maintenance/**, src/server/adapters/maintenance-storage.ts, prisma/schema.prisma, prisma/migrations/**, tests/integration/maintenance-jobs.test.ts, docs/engineering/contracts/operations.md, docs/ops/maintenance.md
  approach: persistent per-job/scope fenced leases, atomic immutable page findings and cursor commits, separate read-only evidence adapter and database reader, count-and-ID-only reports, additive heartbeat fields, unchanged public health
  tests: real non-superuser PostgreSQL and MinIO failure concurrency expired fencing pagination restart no deletion no lifecycle no business writes redaction UUIDv7; real HTTP for any admin read
  risks: provider version pagination and failures, incomplete scans must not advance complete watermark, concurrent evidence changes remain observations only, lease expiry cannot commit stale findings
invariants: [I-07, I-25, I-26, I-28, I-35, I-41, I-45, I-46, I-48, I-51, I-52]
p1: [fixed runtime image packaging, fixed durable progress for healthy slow reads, fixed detached receipt seal coverage, fixed column-level write privilege detection]
tickets: [WHR-221, WHR-174]
---
Plan committed before builder dispatch. All three independent reviewers PASS in round 3 at the reviewed head; clean worktree/head verified after every round.
Round 1 found one SEC-HIGH and three P1s: column grants bypassed role preflight, missing image entrypoints, page-wide timeout prevented progress, and unattached receipt seals escaped reconciliation. All were reproduced before repair and pass after repair.
EM: typecheck/lint/build PASS (four pre-existing image warnings), UUID guard 26 tests/848 sources PASS, unit 1,024 PASS, timezone 5+5 PASS. Full Linux PostgreSQL16/MinIO gate: 82 suites / 1,561 tests PASS, zero skips, exit 0 (215.66s). Final job-source image build PASS; UID 1000 and both packaged CLI fail-closed checks PASS (expected sanitized invalid_configuration/exit 1, network disabled, no module errors).
Merged reviewed staging UI base c65cc86 into fa19e55; no job/server/shared/schema/integration/helper/dependency/image path changed from reviewed 9e25e06. App-wide gates refreshed on the merge; all PR-owned non-evidence paths remain byte-identical to review.
Round 3 reviews only the staging operator clarification after round-2 implementation PASS: shared entrypoint DATABASE_URL must alias the same restricted maintenance connection as MAINTENANCE_DATABASE_URL. Actual network-isolated image smoke confirms early refusal without the alias and job startup with it; no broad web credentials or code changes.
Real PostgreSQL16 role is non-superuser/non-CREATEROLE/non-CREATEDB/non-BYPASSRLS; actual scoped MinIO STS session denies object put/delete/version delete/multipart abort/lifecycle changes. No new admin HTTP read or health projection.
Named integration tests (`tests/integration/maintenance-jobs.test.ts`, 15 cases):
- I-51 report-only runtime has no domain delete, evidence write or lifecycle authority on real PostgreSQL and MinIO
- I-52 simultaneous real-PostgreSQL runners have one active per-job lease
- I-52 bounded version pages resume after restart without replacing committed reports or exposing object names
- I-25/I-28 every retained receipt seal is reconciled even before fact attachment or asset validation
- I-52 default 25-object pages checkpoint healthy 450ms reads beyond ten seconds and resume without replay
- I-52 short leases checkpoint completed healthy reads before expiry and restart at the next asset
- I-52 partial provider failure preserves a committed cursor and cannot advance complete watermark
- I-52 lease expiry fences the old runner after takeover on real PostgreSQL
- I-25/I-26/I-28 reconciliation observes missing and mismatched bytes without repairing evidence or changing credit
- I-51 unsafe database owners are refused before any inventory read
- I-52 an incomplete inventory cannot resume its cursor against a different bucket identity
- I-52 a page that outlives its lease rolls back every finding and checkpoint
- I-25/I-35/I-51 retained sheet sources, holds and revision references survive orphan and receipt inventory
- I-51 column-only UPDATE privilege is refused before any storage inventory
- I-51 column-only INSERT privilege is refused before any storage inventory
Initial attempts exposed fixture migration/CREATE ROLE/name/environment setup requirements and native parallel timing failures (WHR-221). One attempt passed 1,554 cases with only seven receipt cases blocked by its database-name guard. Linux then passed every case but hit known operator teardown WHR-174. Final full gate uses NODE_ENV=test, CI-shaped local Linux/PostgreSQL16/MinIO, four workers and a temporary project config changing only the 15-second test harness / 60-second fixture-hook budgets (82 files / 1,561 cases unchanged). All maintenance operations use restricted non-superuser roles/STS; domain/provider/lease assertions unchanged.
Production execution remains blocked pending WHR-206. Earl's deployed staging check is still required. No cloud resources, customer data, feature STATUS/coverage/lane changes or removal authority.
