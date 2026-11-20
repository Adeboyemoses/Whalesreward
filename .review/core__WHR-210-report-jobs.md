---
branch: core/WHR-210-report-jobs
linear: WHR-210
tier: high
reviewed_head: 7ea3238
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: leased bounded resumable report-only orphan and upload reconciliation jobs
  files: jobs/orphans.ts, jobs/reconcile-uploads.ts, src/server/modules/maintenance/**, src/server/adapters/maintenance-storage.ts, prisma/schema.prisma, prisma/migrations/**, tests/integration/maintenance-jobs.test.ts, docs/engineering/contracts/operations.md, docs/ops/maintenance.md
  approach: persistent per-job/scope fenced leases, atomic immutable page findings and cursor commits, separate read-only evidence adapter and database reader, count-and-ID-only reports, additive heartbeat fields, unchanged public health
  tests: real non-superuser PostgreSQL and MinIO failure concurrency expired fencing pagination restart no deletion no lifecycle no business writes redaction UUIDv7; real HTTP for any admin read
  risks: provider version pagination and failures, incomplete scans must not advance complete watermark, concurrent evidence changes remain observations only, lease expiry cannot commit stale findings
invariants: [I-07, I-25, I-26, I-28, I-35, I-41, I-45, I-46, I-48, I-51, I-52]
p1: []
tickets: []
---
Plan committed before builder dispatch. Review and verification pending.
