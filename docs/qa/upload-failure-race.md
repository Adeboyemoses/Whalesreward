# Upload-failure browser race verification

WO-app-3a / WHR-60. Scope: the partial photo failure and expired signed PUT cases in `tests/e2e/upload-sync.spec.ts`.

Record root-cause evidence before fixing: request/failure persistence, lease ownership/release, navigation timing and recovery after an abandoned lease. Do not record signed URLs or credentials.

Acceptance checks:

1. Reproduce the original failure and identify the durable state before full navigation.
2. Confirm whether recovery occurs after the existing lease deadline; record the observed user-visible delay and retain the original sale/photo.
3. If fixture-only, wait for the actual durable failure and released lease before navigation. No fixed sleeps, production lease changes or added runner retries.
4. Run both cases in both projects for twenty repeats with two workers and zero retries: eighty successful test executions, zero failures/retries.
5. Run the complete browser suite and EM typecheck/lint/unit/build gates.
6. Record two consecutive green CI execution links on the unchanged reviewed feature head before merging.

The EM's final repeat counts, gates and consecutive CI links are recorded in the
review evidence and feature PR. WHR-5 and WHR-7 remain READY; this work does not
claim physical-phone acceptance.

## Diagnosis (2026-11-05)

The two cases replace the document before the failed upload has durably settled.
The partial-photo case navigated immediately after reconnect; the forbidden-PUT
case waited only for the fake transport's request counter. That counter is
incremented before aborting/fulfilling the PUT, not after client error handling.
`SaleSynchronizer` persists `photo_upload_failed`, attempts and backoff through
`patch()`, then releases its lease in a separate `finally` transaction. Full
navigation may abandon either operation. The old 5-second failure-label wait and
20-second completion wait cannot cover the unchanged 60-second lease.

The repair waits on the same operation's IndexedDB row: `photo_upload_failed`,
positive attempt count, scheduled retry, and a null lease, all from one read.
Only then does the test navigate and remove the simulated transport failure.
Credit and retained photo/original assertions remain; the partial-photo case now
also checks exactly one credit, and both check the validated photo after retry.
No production code, lease duration, runner retries or fixed waits changed.

## Reproducible abandoned-lease probe

A temporary test in the same spec used the existing `setPutPaused(true)` fixture:

1. Save offline with `savedOffline`, then reconnect. Poll until one storage PUT
   is recorded and read the real IndexedDB row using `rows(page)`.
2. Assert `state === "uploading"`, `lastErrorCode === null`, and a non-null lease.
   Record its expiry and the wall-clock time immediately before navigation.
3. Navigate to `/attendant/uploads`. Assert the full lease is unchanged and
   unexpired, and the fake authoritative record has zero credits.
4. Release the PUT with `setPutPaused(false)`. Do not click retry or manipulate
   IndexedDB, clocks, or production constants. Wait for the actual
   `All uploads complete` heading with a 75-second assertion budget (90-second
   test budget), then poll for lease release.
5. Assert completion occurred after the recorded expiry, one record and exactly
   one credit, validated photo, and deep equality of original sale and photo
   metadata/digest with the offline snapshot. Record completion time and delay.

Run with `pnpm test:e2e tests/e2e/upload-sync.spec.ts --grep 'abandoned upload lease' --workers=2 --retries=0`.
The probe is removed after diagnosis so the regular suite gains no minute-long
third case. Its real-time results follow below. This transport-fake test verifies
client recovery; it does not substitute for server credit integration tests.

| Project   | Navigation (UTC) | Persisted lease expiry (UTC) | Visible completion (UTC) | Navigation to completion | After lease expiry |
| --------- | ---------------- | ---------------------------- | ------------------------ | ------------------------ | ------------------ |
| Desktop   | 15:14:13.558     | 15:15:13.409                 | 15:15:14.379             | 60,821 ms                | 970 ms             |
| Attendant | 15:14:14.681     | 15:15:14.443                 | 15:15:15.923             | 61,242 ms                | 1,480 ms           |

All times are 2026-11-05. Both retained the unexpired lease immediately after
navigation and passed all recovery assertions. The foreground retry cadence is
1 second; rendering/poll observation adds overhead. No stuck-recovery product
bug was reproduced. The one-minute user-visible wait is real abandoned-lease
behavior, and is not hidden by the repaired failure-retry fixtures.

Builder output before the repair (both projects, two workers, zero retries):

```text
Running 4 tests using 2 workers
  4 passed (1.6m)
```

The intermittent original timeout did not recur in this four-case baseline;
previous reported failures remain the red evidence. The deterministic probe
reproduced their abandoned live-lease precondition rather than asserting a new
baseline failure occurred:

```text
Running 2 tests using 2 workers
  2 passed (1.5m)
```

Runs used the local `whr-upload-browser:lean` container, an isolated PostgreSQL
16 container with deployed migrations and fictional seed, two Playwright
workers, both configured projects, and explicit `--retries=0`. No staging or
production endpoint was used. The feature's final eighty-case repeat run,
complete browser suite, standard gates and two green CI executions belong to
the EM verification record; they are not claimed by these builder checks.

Builder verification after the repair:

```text
pnpm test:e2e tests/e2e/upload-sync.spec.ts --grep 'partial photo failure|expired storage PUT' --workers=2 --retries=0
Running 4 tests using 2 workers
  ✓ [desktop] partial photo failure (18.2s)
  ✓ [attendant] partial photo failure (18.2s)
  ✓ [attendant] expired storage PUT (21.8s)
  ✓ [desktop] expired storage PUT (22.5s)
  4 passed (1.1m)
```

Zero failures and zero retries. Scoped ESLint exited 0 with no diagnostics.

## EM repeat-run investigation

The first independent 80-execution run finished **79 passed, 1 failed (14.0m)**,
with two workers and zero retries. Attendant expired-PUT repeat 13 reached
`Offline access expired` while awaiting completion. The durable failure and
released-lease checkpoint had passed. The trace showed the same context and
sign-in/next-day expiry across all session responses, so this was a different
failure from the original navigation/lease race. The full suite on identical
test/application code passed **68 tests, 4 existing skips (6.3m)**, zero retries.

A temporary read-only observer of clock samples and window writes completed
**40 instrumented executions (6.3m)** without reproducing the lock. An independent
empty Chromium page, with no application or clock mocks, sampled the unchanged
clocks 11,708 times over 60 seconds and observed this real environment rollback:

| Sample | Wall clock (Unix ms) | Monotonic clock (ms) |
| --- | --- | --- |
| Before | 1793893115206 | 38250.8 |
| After | 1793893115203 | 38261.2 |

The wall clock stepped backward 3 ms while the monotonic clock advanced 10.4 ms
(2026-11-05 15:38:35 UTC). The existing I-03 rollback unit test requires even a
1 ms rollback to lock; no production policy change is justified by this result.
The original failed trace lacks clock checkpoints, so attributing that failure
to the observed environment rollback remains an inference, not direct proof.

Diagnostic instrumentation was removed. The EM repeats the unchanged two-case
fix for the required 80 executions; the final result and both CI execution links
are recorded in review evidence and the PR. No browser clocks, expiry checks,
timeouts or retry settings are changed to obtain a pass.
