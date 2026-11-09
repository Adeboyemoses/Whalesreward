# WO-core-6a P-21 backend verification

Part of WHR-80. EM independently verified exact production source `ccc686e` on
9 November 2026 using dedicated local PostgreSQL 16/MinIO fixtures. Linux Chromium
used a git archive of that source, Node 26.12.0 and the frozen lockfile.

| Command | Actual result |
|---|---|
| `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | PASS; 260 unit tests, no lint warnings, production build and Workbox worker built |
| `pnpm db:migrate:deploy` | Seven migrations applied successfully to fresh EM database; no new migration |
| `pnpm test:integration` | 16 files / 201 tests passed, zero failed/skipped |
| `pnpm test:time` | Three tests passed under UTC and three under America/New_York |
| `pnpm test:e2e` (Linux Chromium) | 130 passed, four existing staging-only skips, zero failed/retried |
| `pnpm exec playwright test -c tests/storage/playwright.config.ts` | One passed |

Named command:

```sh
pnpm exec vitest run --project integration tests/integration/offboarding-management.test.ts tests/integration/offboarding-adversarial.test.ts --reporter=verbose
```

Actual named output: 23 passed, zero failed/skipped, 3.97 seconds. The parameterized
`U minus 1`, `U minus 0` and `U minus -1` cases mean one microsecond before U, at U,
and one microsecond after U respectively.

```text
PASS end committed before waiting sign-in cannot mint authority
PASS I-07 P-21 either pumps grant independently authorizes assignment end
PASS end committed before waiting first-password cannot mint authority
PASS I-07 P-21 either attendants grant independently authorizes assignment end
PASS sign-in ordered before end commits is revoked with its context
PASS I-07 P-21 no-grant admins and ordinary attendants cannot end assignments or acquire recovery authority
PASS first-password completion before end invalidates old credential proof waiting to sign in
PASS I-07/I-41 P-21 strict HTTP and exact non-null guards reject without side effects
PASS I-09/I-41 P-21 disabled and absent targets cannot produce a receipt or ending audit
PASS P-20 end at U minus 1 microsecond preserves original bounds and first receipt through actual same-account resumption
PASS I-07/I-09 P-21 permission removed while waiting on security lock cannot authorize end
PASS I-07 P-21 successful replay rechecks the actor's current grant before returning the stored receipt
PASS P-20 end at U minus 0 microsecond preserves original bounds and first receipt through actual same-account resumption
PASS I-09 P-21 every existing protected attendant read and write rejects full and restricted device cookies after end
PASS I-09/I-26 P-21 assignment end during a real evidence write prevents finalize credit at commit
PASS P-20 end at U minus -1 microsecond preserves original bounds and first receipt through actual same-account resumption
PASS I-07 P-21 the actual POST route passes the URL attendant ID to guarded assignment ending
PASS I-09 P-21 protected reads waiting behind assignment end reauthorize after its commit
PASS ends exactly one interval with durable applied receipt, immutable opening history and actual ending audit
PASS serializes end/end and end/reassignment with exactly one reviewed winner
PASS failed guards and audit failure roll back assignment, auth state and receipt
PASS I-09 P-21 revoked sign-in replay cannot restore a ready session or anchor
PASS I-09 P-21 revoked sign-in replay cannot restore a first-password session or anchor
```

The tests inspect actual audit rows, all device/session/context revocation, immutable
opening history and applied receipts. A successful end replay after reassignment
returns the old unassigned snapshot without revoking the new session/context.
Deterministic commit/storage barriers exercise real PostgreSQL and the protected
route/handlers; finalization during real MinIO writes cannot credit after offboarding.
P-20 cases use historical fixture contexts anchored to actual trusted end time,
retain original S/R/U, and perform real reassignment, fresh same-account sign-in,
original submit, photo validation and finalize. No production clock hook is added.

Two older `sync-sales.test.ts` setup sections closed the sole assignment in SQL while
retaining ordinary upload authority, a state the new P-21 contract rejects. They now
supply a current replacement assignment plus fresh same-account upload token. Original
capture/context/timestamps, receipt and every price/assignment/campaign/retry assertion
remain unchanged. The active-assignment guard is retained, not removed for the tests.

Scope: guarded assignment ending, M1/P-21 ready/restricted sign-in, protected authority
and historical queue validation. No UI parity, disable/reset/deactivation endpoint,
cloud operation or manual staging-data change. Full M3 recovery-grant/capture-review
APIs remain future work: these tests do not fabricate those routes or grant authority.
Later same-account resumption is exercised; existing capture blocks stay zero-credit.
An offline phone cannot observe revocation instantly; originals, blobs and IDs remain
account-partitioned under the existing client protocol. No gate or assertion relaxed.

An explicit follow-up test-only change (`2cb34c8`) adds ready and restricted sign-in
key replay after actual offboarding. Old keys return401, fresh valid credentials
without an assignment return422 with the exact generic message, wrong credentials
remain401, and no attempt issues a cookie, context or anchor or changes the receipt.
EM reran typecheck/lint/unit260/build and full integration201 plus named23 after this
addition. Production source remains exactly `ccc686e`; timezone and Linux browser
results above apply to that unchanged source. No production fix was needed after review.
