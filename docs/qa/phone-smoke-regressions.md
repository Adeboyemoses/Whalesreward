# WO-app-3b regression evidence

Part of WHR-65. Local browser tests use fictional HTTP fixtures and a local PostgreSQL database; they do not claim deployed-server credit or physical-phone acceptance. Real staging measurements are recorded separately by the EM.

## Before fixes

Source baseline: `1a6316c` (test worktree starts from plan commit `d5c84b1`, no application differences). Linux Docker, Node 26.12.0, pnpm 10.17.1, Playwright 1.64.1, Chromium; attendant profile, one worker, zero retries.

- Existing offline-save/restart harness check: **2 passed, 0 failed**, desktop and attendant profiles, two workers, zero retries.
- Initial new regression run: **3 passed, 7 failed**. Deferred online revalidation withholds the valid local form and the expired screen; the delayed-account scenario also fails at that prerequisite. Failed request leaves Online displayed. PMS and gas amount fields remain `20000` after blur instead of `20,000.00`. Warm localhost 3G/offline transitions and unchanged quantity validation pass.
- Isolated stalled RSC case: receipt visibility fails at **2,000 ms** while the response is deliberately held.
- Isolated real navigation case: local HTTP proxy observes the dynamic receipt document request; the old service worker does not fall back. `page.goto` fails at its explicit **2,000 ms** deadline. This is a real worker fetch through the proxy, not an intercepted browser-route response.

The tests hold requests with explicit release promises and release them in cleanup; no sleeps, skipped regressions or runner retries were added. Network shaping is 400 ms latency and 50,000 bytes/s in each direction. The local warm timing pass does not contradict the slower actual staging measurements.

## Coverage under test

`tests/e2e/phone-smoke.spec.ts` covers local-first display followed by a delayed authoritative revocation, sticky expiry despite delayed success, cross-account stale response, two-second save/next with pending upload, offline/3G, stalled RSC, actual service-worker fallback, browser events/request outcomes, exact amount/quantity semantics, and pending/assigned/credited references for PMS and gas. Upload-reference tests wait for durable failure bookkeeping before full navigation, preserving the WHR-60 fixture rule.

Final integrated results and independent board fidelity remain pending.

# Integrated verification

Application head `8cf5afd`, with final test-only fixture amendments; both projects, zero runner retries and no skipped cases.

- First integrated run: **17 passed, 7 failed**. Cross-account assertions incorrectly expected the original tab to leave the safe sign-in route automatically. The test now checks no original identity, then explicitly navigates to the new account's form. Repeated amount fills raced focus restoration; the helper now focuses and waits for raw text before replacement.
- Second run: **20 passed, 4 failed**. Two artifact ENOENT failures came from parity sharing the functional output directory. One cold navigation totaled 2462.4ms under concurrent load. Parity now has separate output and timing checks run alone.
- The delayed401 fixture could capture the prior document's late startup request after worker setup reloaded. It now arms at the explicit main-frame navigation commit. Both projects then passed while subsequent fake session responses remained successful, proving denial remains sticky without globally revoking the fake.
- Clean isolated targeted run: **23 passed, 1 failed (2.6m)**. The sole failure constrained complete cold receipt hydration to two seconds: document commit met two seconds, but total receipt visibility was **2250.3ms**. EM confirmed cold navigation requires bounded shell fallback; the user's two-second end-to-end threshold applies to Save and Record next sale. The corrected test asserts document commit within two seconds, then hydration within two seconds separately. Save/next thresholds are unchanged.
- Corrected SW rerun with two workers: **4 passed, 0 failed (43.5s)**, stalled headers and body through the actual worker in both projects. All 24 targeted cases have passing evidence across these runs; this is not a single 24/24 run. EM independently runs the final full suite.

Expiry starts at 23:59 and advances 60 seconds to avoid a one-second setup race while testing the exact 24-hour boundary. No authorization rule changed. Exact 2000001 kobo is asserted in PMS and gas originals.

Local test command: `docker exec -w /app -e DATABASE_URL=postgresql://postgres@whr-phone-db:5432/whr_phone_test whr-phone-tests pnpm test:e2e tests/e2e/phone-smoke.spec.ts --workers=2 --retries=0`. EM receives the tracked-source archive sync commands separately. The isolated fictional Postgres has no published host port. No secrets were read. Do not run timing checks concurrently with screenshots. Fidelity report: `tests/design-parity/phone-smoke/REPORT.md`.
