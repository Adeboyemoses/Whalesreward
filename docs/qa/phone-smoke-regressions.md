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
