---
branch: core/wo-7-customers-cards
linear: WHR-12
tier: high
reviewed_head: 0000000
rounds: 1
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: implement the approved M2 online registration, customer reads and card batch/export contracts
  files: prisma/**, src/shared/contracts/**, src/server/modules/customers/**, src/server/modules/cards/**, src/app/api/**, tests/**, package.json, pnpm-lock.yaml
  approach: reuse live security locks and Domain receipts; atomically link normalized identities; serialize inventory snapshots and render only immutable export rows behind private downloads
  tests: real PostgreSQL phone/card races, retry/collision rollback, lifecycle/version races, accepted totals, snapshot/linking races, revoked preparation/download and actual PDF/XLSX contents
  risks: preserve historical provenance without inventing attribution; keep D08 phone/layout policy gates closed when unset; never change sale credit or emit PII in exports/audit
invariants: [I-14, I-15, I-16, I-17, I-18, I-19, I-20, I-48, I-50, I-52]
p1: []
tickets: []
---
Implementation and independent review pending. No READY claim.
