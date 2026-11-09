---
branch: core/wo-7-customers-cards
linear: WHR-12
tier: high
reviewed_head: 3161c086d6cf1cfae338a3eaf69981cd3388c51c
rounds: 3
builder: backend-engineer
reviewers:
  code-reviewer: PASS (round 3)
  security-reviewer: PASS (round 3)
  integrity-reviewer: PASS (round 3)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 14
plan:
  goal: implement the approved M2 online registration, customer reads and card batch/export contracts
  files: prisma/**, src/shared/contracts/**, src/server/modules/customers/**, src/server/modules/cards/**, src/app/api/**, tests/**, package.json, pnpm-lock.yaml
  approach: reuse live security locks and Domain receipts; atomically link normalized identities; serialize inventory snapshots and render only immutable export rows behind private downloads
  tests: real PostgreSQL phone/card races, retry/collision rollback, lifecycle/version races, accepted totals, snapshot/linking races, revoked preparation/download and actual PDF/XLSX contents
  risks: preserve historical provenance without inventing attribution; keep D08 phone/layout policy gates closed when unset; never change sale credit or emit PII in exports/audit
invariants: [I-02, I-04, I-07, I-09, I-14, I-15, I-16, I-17, I-18, I-19, I-20, I-41, I-42, I-44, I-48, I-50, I-52]
p1: ["fixed exhausted final leases with bounded fenced recovery (0be03d7)", "fixed configuration-blocked PDF recovery and XLSX capacity (09e39ec)"]
tickets: [WHR-82]
---
The original pre-builder plan block remains unchanged. Necessary support paths
also reviewed within the approved M2 scope are src/server/adapters/** (phone and
private artifact adapters), src/instrumentation.ts (automatic preparation), and
docs/engineering/{contracts,data-model} plus docs/qa (compatibility and evidence).
All three independent roles passed round three at the exact reviewed head.
Round one found exhausted final leases; round two found queued PDFs skipped after
layout loss. Scoped fixes preserve live leases, snapshots, inventory and fencing;
three plus twenty-seven RED/GREEN PostgreSQL regressions verify both recoveries.
EM typecheck/lint/build, unit318, PostgreSQL260, named59+58 units, timezone3 per
zone, exact-source Linux browser130/four old skips/zero retries and storage1 PASS.
Full output: docs/qa/verification-2026-11-09-customers-cards.md.
Feature dispatch flag14>8: five builder/test dispatches and nine independent
review dispatches for two verified recovery fixes; three rounds remain within cap3.
WHR-82 tracks the moderate advisory in ExcelJS's unused UUID functions; no high
or critical dependency advisory, P0, SEC-HIGH or INTEGRITY-P1 remains open.
No UI parity, main promotion, cloud action or manual staging-data change is claimed.
