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

Independent board fidelity is recorded in `tests/design-parity/phone-smoke/REPORT.md`; final EM verification follows below.

# Integrated verification

Application head `8cf5afd`, with final test-only fixture amendments; both projects, zero runner retries and no skipped cases.

- First integrated run: **17 passed, 7 failed**. Cross-account assertions incorrectly expected the original tab to leave the safe sign-in route automatically. The test now checks no original identity, then explicitly navigates to the new account's form. Repeated amount fills raced focus restoration; the helper now focuses and waits for raw text before replacement.
- Second run: **20 passed, 4 failed**. Two artifact ENOENT failures came from parity sharing the functional output directory. One cold navigation totaled 2462.4ms under concurrent load. Parity now has separate output and timing checks run alone.
- The delayed401 fixture could capture the prior document's late startup request after worker setup reloaded. It now arms at the explicit main-frame navigation commit. Both projects then passed while subsequent fake session responses remained successful, proving denial remains sticky without globally revoking the fake.
- Clean isolated targeted run: **23 passed, 1 failed (2.6m)**. The sole failure constrained complete cold receipt hydration to two seconds: document commit met two seconds, but total receipt visibility was **2250.3ms**. EM confirmed cold navigation requires bounded shell fallback; the user's two-second end-to-end threshold applies to Save and Record next sale. The corrected test asserts document commit within two seconds, then hydration within two seconds separately. Save/next thresholds are unchanged.
- Corrected SW rerun with two workers: **4 passed, 0 failed (43.5s)**, stalled headers and body through the actual worker in both projects. All 24 targeted cases have passing evidence across these runs; this is not a single 24/24 run. EM independently runs the final full suite.

Expiry starts at 23:59 and advances 60 seconds to avoid a one-second setup race while testing the exact 24-hour boundary. No authorization rule changed. Exact 2000001 kobo is asserted in PMS and gas originals.

Local test command: `docker exec -w /app -e DATABASE_URL=postgresql://postgres@whr-phone-db:5432/whr_phone_test whr-phone-tests pnpm test:e2e tests/e2e/phone-smoke.spec.ts --workers=2 --retries=0`. EM receives the tracked-source archive sync commands separately. The isolated fictional Postgres has no published host port. No secrets were read. Do not run timing checks concurrently with screenshots. Fidelity report: `tests/design-parity/phone-smoke/REPORT.md`.

## Round 1: resolved-card lookup gate

Review found that CDP network throttling does not delay the route-fulfilled fake lookup, so the earlier 3G browser test did not prove Save was independent of a repeated online card lookup. A new test resolves the customer and photo normally, then holds every subsequent lookup response indefinitely while remaining online. It asserts Save→receipt and Record next→empty form each within two seconds without waiting for a lookup request to start. It also verifies the exact original account/context/card/spend, retained customer, photo digest and durable original/photo after reset, with no falsely credited receipt or server-shaped record. The gate and paused PUT release in `finally`.

RED on unchanged `f2865f44`: **0 passed, 2 failed**, both desktop and attendant receipt-visible assertions timed out at 2000ms while every later lookup remained held. Only then was builder fix `5559123` applied. GREEN with `5559123`, identical test and two workers: **2 passed, 0 failed (36.4s)**, no skips or retries. Both Save and next retain the end-to-end two-second assertions. The repeated lookup remains live in the background so late authoritative denial is still consumed; builder unit tests cover those denial responses. This is local browser evidence, not a new staging measurement. Typecheck and lint passed for the test change. No screenshots were rerun for this logic-only fix.

## Final EM verification

[Feature PR #49](https://github.com/Adeboyemoses/Whalesreward/pull/49) merged into staging at `d3481fc6e39dabe8ab5e087ee581b91d891f56ed` on 5 November 2026. Code, security and integrity reviewers all passed round 2 at `59362ad`; the evidence validator passed. Subsequent staging merges changed unrelated core/admin files and records; the phone feature files stayed unchanged.

- Reviewed phone head: typecheck, lint, 159 unit tests, build, 3 timezone tests in each timezone and full browser 94 passed / 4 existing conditional skips / 0 retries (7.2m).
- Final combined admin base: typecheck, lint, 164 unit tests (26 files), build and full browser 94 passed / 4 existing conditional skips / 0 retries (6.3m). The two new core migrations applied only to the disposable local test database for this check. The final records-only base update changed no application or test source.
- [Final CI](https://github.com/Adeboyemoses/Whalesreward/actions/runs/42094998766): all required checks green; integration 129, 3 timezone tests in each timezone, browser 94 passed / 4 existing conditional skips / no flaky cases, storage 1. Independent fidelity: 6 passed, 12 screenshots and line-box measurements at 390/360 px. Guard self-tests 94 passed.
- The first CI run retried one existing handover fixture after its sign-in navigation collided with the app's navigation. [WHR-67](https://linear.app/phaneum/issue/WHR-67) tracks that P2 follow-up separately. The later two combined CI runs were clean. No sleeps or increased runner retries were added.

Actual staging health reported the feature version and `db: ok` after deployment. No deployed after-performance marks are claimed. `phone-stall-baseline.md` records the instruction against Computer Use timings, Rook's successful Samsung rerun report and Earl's subsequent explicit acceptance/closeout instruction for WHR-65, WHR-7 and WHR-5.
