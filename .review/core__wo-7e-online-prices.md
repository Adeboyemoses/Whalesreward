---
branch: core/wo-7e-online-prices
linear: WHR-127
tier: high
builder: backend-engineer
plan:
  goal: Implement P-27 current committed online price snapshots on session GET and card lookup.
  files: src/shared/contracts/**, src/server/modules/auth/**, src/server/modules/sync/**, src/server/lib/**, src/app/api/attendant/**, tests/integration/**, tests/unit/**
  approach: Add strict independently negotiated lookup shapes and legacy-compatible shared decoding; serialize acknowledged-context price reads with activation and P-23 receipt issuance using existing database locks.
  tests: Exact P-27 schema and capability matrix, PostgreSQL activation/read races and context/reassignment cases; map PR-T1-01 through PR-T1-12 to core tests and explicit app obligations; run all mandatory gates and existing settlement regressions.
  risks: Lock ordering and receipt instant consistency; preserve auth, throttling, sign-in replay, immutable context and expiry; no receipt-claim, capture-bound, sale-digest, settlement, client-flow or schema migration changes.
invariants: [I-03, I-04, I-05, I-05a, I-09, I-16, I-17, I-29, I-31, I-32, I-49, I-50]
---

Approved scope: m1.md Online price refresh — P-27 and WHR-127. No STATUS, coverage or lane edits.
