---
branch: core/wo-4a-capture
linear: WHR-62
tier: high
plan:
  goal: Implement P-20 capped capture policy without silently re-evaluating existing sales.
  files: src/server/modules/sync/capture-policy.ts, src/server/modules/sync/capture-policy.test.ts, src/server/modules/sync/settle.ts if needed, tests/integration/sync-sales.test.ts, tests/helpers/sync-fixture.ts if needed, coverage-map.md, core lane and STATUS.md.
  approach: Compute exact BigInt U=min(receivedAt, original offlineExpiresAt); use closed [S,U] for capture history, retain R for upload deadline, bump CAPTURE_POLICY_VERSION for new settlements only.
  tests: RED then GREEN Monday 07:00 sign-in through Tuesday 09:05 receipt; changes before/at/after U at microsecond precision; deadline uses R; fresh upload authority; persisted version and held replay unchanged; full EM gates and time suite.
  risks: Capping the wrong clock could grant campaign eligibility after deadline or hide in-window changes; retry must preserve first receipt, original context and old policy results.
invariants: [I-03, I-05a, I-22, I-26, I-28, I-31, I-45a]
---

Approved scope: WHR-62 against merged WHR-61/P-20 (5304f34). No M3 capture-review endpoint, migrations, backfill or cloud operations.
