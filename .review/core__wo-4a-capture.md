---
branch: core/wo-4a-capture
linear: WHR-62
tier: high
reviewed_head: 1e7158a61033b5e896a8f6fcc638e71ee0f2721f
rounds: 1
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 4
p1: []
tickets: []
plan:
  goal: Implement P-20 capped capture policy without silently re-evaluating existing sales.
  files: src/server/modules/sync/capture-policy.ts, src/server/modules/sync/capture-policy.test.ts, src/server/modules/sync/settle.ts if needed, tests/integration/sync-sales.test.ts, tests/helpers/sync-fixture.ts if needed, coverage-map.md, core lane and STATUS.md.
  approach: Compute exact BigInt U=min(receivedAt, original offlineExpiresAt); use closed [S,U] for capture history, retain R for upload deadline, bump CAPTURE_POLICY_VERSION for new settlements only.
  tests: RED then GREEN Monday 07:00 sign-in through Tuesday 09:05 receipt; changes before/at/after U at microsecond precision; deadline uses R; fresh upload authority; persisted version and held replay unchanged; full EM gates and time suite.
  risks: Capping the wrong clock could grant campaign eligibility after deadline or hide in-window changes; retry must preserve first receipt, original context and old policy results.
invariants: [I-03, I-05a, I-22, I-26, I-28, I-31, I-45a]
---

Approved scope: WHR-62 against merged WHR-61/P-20 (5304f34). No M3 capture-review endpoint, migrations, backfill or cloud operations.

P-20 uses exact BigInt capture bounds and keeps actual first receipt for upload deadlines. New settlements store policy version 2; existing held rows and original capture facts remain unchanged. Production changes are confined to the policy module.

All three independent reviewers passed in round 1 without findings. Each independently ran the 24 policy tests; settlement, replay, live authorization and the integration regressions were inspected. EM confirmed clean worktree and unchanged review head after the reviews.

Builder observed 13 policy-test failures and the Monday/unversioned-settlement failures under v1, plus all three PostgreSQL expiry-boundary failures; all pass under v2. EM reran typecheck, lint, 108 unit tests, build, 104 real PostgreSQL/MinIO tests and three time tests in each timezone. Final-head browser and CI results are pasted in the PR and WHR-62 before READY.

```text
REVIEW-VERDICT
reviewer: code-reviewer
branch: core/wo-4a-capture
head: 1e7158a61033b5e896a8f6fcc638e71ee0f2721f
result: PASS
findings: []
blocking: {P0: 0, SEC-HIGH: 0, INTEGRITY-P1: 0}

REVIEW-VERDICT
reviewer: security-reviewer
branch: core/wo-4a-capture
head: 1e7158a61033b5e896a8f6fcc638e71ee0f2721f
result: PASS
findings: []
blocking: {P0: 0, SEC-HIGH: 0, INTEGRITY-P1: 0}

REVIEW-VERDICT
reviewer: integrity-reviewer
branch: core/wo-4a-capture
head: 1e7158a61033b5e896a8f6fcc638e71ee0f2721f
result: PASS
findings: []
blocking: {P0: 0, SEC-HIGH: 0, INTEGRITY-P1: 0}
```
