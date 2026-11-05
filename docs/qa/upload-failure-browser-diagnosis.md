# Upload-failure browser diagnosis

WO-app-3a (WHR-60), 5 November 2026.

The failures were fixture navigation races. The partial-photo fixture navigated immediately after reconnect. The expired-PUT fixture observed the fake's request log, which is written before its response reaches the browser. Neither observation establishes that the client has persisted `lastErrorCode: photo_upload_failed` and released its durable upload lease.

The failure handler and lease release are separate IndexedDB transactions. Full navigation can abandon that work, leaving a live 60-second lease. The original five-second failure assertion or 20-second retry assertion can therefore expire while the new page correctly waits for the old lease.

Both fixtures now poll the original account and operation's persisted failure plus `syncLease: null` before navigating. Existing UI, retained-photo, account and single-sale assertions remain. Production code, `LEASE_MS`, runner configuration and unrelated tests are unchanged; no sleeps or runner retries were added.

## Diagnosis evidence

- Historical [PR #44 CI attempt 3](https://github.com/Adeboyemoses/Whalesreward/actions/runs/41970439893/attempts/3): 67 passed, one partial-photo failure, four existing staging-only skips, two workers. The failure exhausted its existing runner retries.
- Unchanged local Linux baseline, both profiles, three repeats, two workers and zero retries: nine passed, three failed. Every failure was the partial-photo fixture; persisted state remained `saved`, with no failure code and approximately 55 seconds left on an active lease. Navigation can interrupt synchronization even before submission finishes.
- Temporary browser diagnostic paused the PUT, observed the acquired lease, navigated, then released the fake response and polled for natural recovery. Both profiles preserved the same abandoned lease before expiry. Recovery credited the original sale once after 60,235 ms (desktop) and 60,195 ms (attendant), measured after navigation. The original photo and sale remained intact. There were no sleeps, clock changes or lease changes. Diagnostic instrumentation was removed.
- The expired-PUT baseline passed all six executions, but its request-start observation has the same race; it now waits for durable failure and lease release too.

## Repeat verification

The local host blocked Chromium startup before test execution. Browser verification therefore uses an isolated local Linux Docker container with Node 26.12.0, pnpm 10.17.1 and Playwright Chromium. This is local browser execution against fictional fixtures, not deployed-service or physical-phone acceptance.

```sh
CI=1 pnpm test:e2e tests/e2e/upload-sync.spec.ts \
  --grep 'partial photo failure|expired storage PUT' \
  --workers=2 --retries=0 --repeat-each=20
```

Required result: 80 passes (two cases × two profiles × 20 consecutive executions), zero failures, skips or runner retries. Final counts and two consecutive CI run links are recorded in the PR and WHR-60 READY comment.
