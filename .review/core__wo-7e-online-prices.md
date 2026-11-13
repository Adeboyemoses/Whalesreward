---
branch: core/wo-7e-online-prices
linear: WHR-127
tier: high
builder: backend-engineer
reviewed_head: 43f3c2b3d5aec4d95ca2cc1b4584213091e2920e
rounds: 1
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
plan:
  goal: Implement P-27 current committed online price snapshots on session GET and card lookup.
  files: src/shared/contracts/**, src/server/modules/auth/**, src/server/modules/sync/**, src/server/lib/**, src/app/api/attendant/**, tests/integration/**, tests/unit/**
  approach: Add strict independently negotiated lookup shapes and legacy-compatible shared decoding; serialize acknowledged-context price reads with activation and P-23 receipt issuance using existing database locks.
  tests: Exact P-27 schema and capability matrix, PostgreSQL activation/read races and context/reassignment cases; map PR-T1-01 through PR-T1-12 to core tests and explicit app obligations; run all mandatory gates and existing settlement regressions.
  risks: Lock ordering and receipt instant consistency; preserve auth, throttling, sign-in replay, immutable context and expiry; no receipt-claim, capture-bound, sale-digest, settlement, client-flow or schema migration changes.
invariants: [I-03, I-04, I-05, I-05a, I-09, I-16, I-17, I-29, I-31, I-32, I-49, I-50]
p1: []
tickets: []
---

Approved scope: m1.md Online price refresh — P-27 and WHR-127. No STATUS, coverage or lane edits.

Session GET and independently negotiated card lookup expose a whole current price snapshot for the acknowledged context, serialized with activation. Four strict lookup shapes and legacy normalization preserve independent P-23/P-27 rollout. Receipt claims, capture bounds, sale digests and settlement code are unchanged.

All three independent reviewers passed round 1 at the reviewed head with no findings. The worktree stayed clean and HEAD unchanged after each review. Code reviewer independently ran 47 schema and 31 PostgreSQL tests; security ran 18 PostgreSQL cases; integrity ran both integration suites (31 tests).

EM final-head gates: typecheck PASS; lint PASS (two existing image warnings); complete unit suite PASS; production build PASS; PostgreSQL 37 files / 775 tests PASS. Time suite passed 5 tests in UTC and 5 in America/New_York. Native e2e attempted with max-failures=1; macOS sandbox refused Chromium launch before application assertions. Full CI browser check is required before merge.

New verification: 47 strict schema cases, 18 PostgreSQL capability/context/activation race cases and 13 preservation cases. tests/integration/p27-verification.md maps every PR-T1-01 through PR-T1-12 row, distinguishing core evidence from the approved separate app follow-on.

Pre-review investigation added seven whitespace rejection cases; the suspected regex issue did not reproduce, so runtime validation was unchanged. Dispatches: backend builder, independent test builder, backend regression follow-up and three reviewers.
