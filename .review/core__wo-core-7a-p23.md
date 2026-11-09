---
branch: core/wo-core-7a-p23
linear: WHR-93
tier: high
reviewed_head: pending
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Implement P-23 signed lookup lower bounds exactly as M1 and M2 spec 91.
  files: src/shared/contracts/**, src/server/modules/sync/**, src/server/modules/customers/**, src/server/modules/corrections/**, src/server/lib/**, src/app/api/**, prisma/**, tests/**, docs/ops/**
  approach: Configuration-only canonical HMAC receipts; serialized lookup and atomic registration snapshots; additive capability projection; first-receipt verification and versioned digest; shared closed interval policy using immutable L and original S/R/U.
  tests: Real-Postgres register-then-sell, before/after lookup changes, exact boundaries, tampering/binding and malformed fallback, delayed upload, rotation, concurrent replacement, immutable retry/recovery, independent holds; typecheck/lint/unit/build/integration/e2e/time.
  risks: Keys never committed or logged; missing configuration must preserve legacy operation; immutable legacy digests and registration projection; consistent history under replacement; additive migration without fabricated historical evidence; independent holds and recovery permissions unchanged.
invariants: [I-03, I-05a, I-19, I-21, I-22, I-26, I-28, I-28a, I-31, I-33, I-35, I-36, I-45a, I-45b, I-50]
p1: []
tickets: []
---

Approved scope: M1 "Signed lookup lower bound — P-23" and M2 registration amendment.
1. Test strict receipt encoding, configured key rotation, and legacy/capable response projection; implement issuance with live-session binding and serialized card history.
2. Test frozen registration replay and legacy null projection; persist original evidence within the registration transaction independent of capability.
3. Test permissive evidence intake and immutable semantic digests; persist input, verification, claims, policy version and L atomically with first receipt.
4. Test shared [L,U] evaluation and card link at R; preserve original S/R/expiry across retry, finalize, corrections and recovery.
5. Run the named Postgres acceptance cases and final gates; independent code/security/integrity review within three rounds.
6. Commit reviewed evidence, validate, open feature PR into staging, merge only when green, report READY with named output and configuration names.

No app receipt storage, hold-review scope expansion, STATUS/coverage/lane edits, cloud configuration or main promotion.
