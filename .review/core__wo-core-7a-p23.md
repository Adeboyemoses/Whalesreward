---
branch: core/wo-core-7a-p23
linear: WHR-93
tier: high
reviewed_head: 7002fcbeb68b6ad0564b22489016492335450305
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 9
plan:
  goal: Implement P-23 signed lookup lower bounds exactly as M1 and M2 spec 91.
  files: src/shared/contracts/**, src/server/modules/sync/**, src/server/modules/customers/**, src/server/modules/corrections/**, src/server/lib/**, src/app/api/**, prisma/**, tests/**, docs/ops/**
  approach: Configuration-only canonical HMAC receipts; serialized lookup and atomic registration snapshots; additive capability projection; first-receipt verification and versioned digest; shared closed interval policy using immutable L and original S/R/U.
  tests: Real-Postgres register-then-sell, before/after lookup changes, exact boundaries, tampering/binding and malformed fallback, delayed upload, rotation, concurrent replacement, immutable retry/recovery, independent holds; typecheck/lint/unit/build/integration/e2e/time.
  risks: Keys never committed or logged; missing configuration must preserve legacy operation; immutable legacy digests and registration projection; consistent history under replacement; additive migration without fabricated historical evidence; independent holds and recovery permissions unchanged.
invariants: [I-03, I-05a, I-19, I-21, I-22, I-26, I-28, I-28a, I-28b, I-31, I-33, I-35, I-36, I-45a, I-45b, I-50]
p1: ["fixed replacement hold normalization without hiding independent history uncertainty", "fixed Unicode evidence key ordering while preserving legacy digests"]
tickets: []
---

Implements M1 P-23 and M2 registration evidence: strict configured HMAC receipts, live-session issuance, capability projection, immutable registration replay and original submission evidence, shared [L,U] policy and historical link at R.
Backend and test-engineer builders worked in separate worktrees. Round 1 found a duplicate replacement reason that prevented legitimate hold resolution, Unicode collation ties changing retry digests, and BOM acceptance despite strict canonical bytes. All three received failing regressions before fixes; round 2 code/security/integrity verdicts PASS at the reviewed head.
Replacement failures use the existing resolvable hold without masking independent history problems. New evidence has total Unicode key ordering; legacy sync-v1 hashing is unchanged. Verification compares canonical payload bytes exactly.
PostgreSQL JSONB cannot represent NUL/unpaired-surrogate values or keys. A documented additive immutable canonical JSON TEXT field preserves those inputs losslessly; the specified JSONB projection remains available for representable evidence. No fallback sale is rejected for those values.
EM final gates: typecheck PASS; lint PASS; unit 54 files/470 tests PASS; integration 22 files/376 tests PASS; build PASS; time 2 files/5 tests PASS in each timezone.
EM named Postgres P-23 suite: 1 file/46 tests PASS, covering registration, replay, bindings, malformed fallback, history boundaries, rotation, delayed upload, controlled replacement interleaving, immutable retry/correction/recovered-correction provenance and independent holds.
Local pnpm test:e2e on the final code head timed out waiting 180 seconds for its web server. An earlier suite attempt and direct Chromium probe also failed at browser launch with macOS sandbox MachPortRendezvousServer permission denied. Required CI browser checks must pass before merge.
Recovery coverage uses existing trusted durable correction provenance; no new general recovery intake is claimed. Ordinary authorization and midnight/correction cutoff rules remain unchanged.
Staging configuration for Earl: WHR_LOOKUP_RECEIPT_KEYS and WHR_LOOKUP_RECEIPT_ACTIVE_KID; names only, no key values. Missing configuration leaves capable evidence null and legacy flows operational.
Dispatch flag: 9 exceeds the high-tier advisory flag of 8 (two builders, three round-1 reviewers, one fix dispatch, three round-2 reviewers); rounds 2 within cap 3, no escalation or gate bypass.
No app receipt storage, hold-review scope expansion, STATUS/coverage/lane edits, cloud configuration or main promotion.
