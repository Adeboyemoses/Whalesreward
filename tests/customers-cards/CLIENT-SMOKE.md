# WHR-92 client smoke regression evidence

Local production Next.js build, Linux Chromium through the local browser container, 390 × 844 viewport, isolated fictional PostgreSQL database `whr_app6_client_smoke`. No staging/cloud data, no secret files. Browser traces, screenshots and videos disabled. Independent board fidelity remains the test engineer's responsibility.

## Baseline red

The unchanged starting production build passed the real unknown-code lookup and navigation: `Z9Z9Z9Z` returned 404 `customer_not_found`, offered Register this customer and opened the real registration form. The reported missing button was not reproduced. The optional candidate prefill was absent.

The first three new browser regressions failed **3/3**, zero retries: candidate field was empty, malformed `I9Z9Z9Z` displayed the registration-needed notice, and a real reassignment followed by a session refresh displayed no Sale warning. Tests were written and run before product edits.

## Initial frontend verification

After the frontend changes, all four focused cases passed **4/4 (7.8 seconds)**, zero retries: valid unknown/form/prefill, all invalid alphabet/length cases without an HTTP lookup, cross-screen warning and fresh-sign-in clearing, and a reassignment arriving during a deliberately blocked photo-hash/save. The last test verified the saving UI remained in place, then released the real hash and observed exactly one durable row with original account/assignment and matching saved photo digest.

The warning test was then strengthened to retain a genuine pre-change session envelope as a delayed transport response while the configured-assignment endpoint read the newer real assignment. Account showed the warning, but an immediate offline native navigation to Sale lost it: **1/1 failed** at the expected warning assertion. Normal online navigation refreshes had masked this boundary. The offline engineer owns durable advisory-flag persistence and sticky same-context refresh; this stronger test must pass after integration before READY.

## Commands and limitations

`pnpm typecheck`, `pnpm lint`, and `pnpm test` passed after the frontend changes: **52 files, 454 tests passed**, zero failures. The final `pnpm build` also passed after the polling-overlap guard. Full combined final-head gates remain the EM's responsibility.

Targeted Linux browser command used the temporary `/private/tmp/whr-client-smoke-browser.config.mts`, importing the existing customer-card config with `testMatch: m2-smoke-fixes.spec.ts`, a 390 px project, local browser `connectOptions`, the existing isolated database setup, and `pnpm start --hostname 0.0.0.0` in the frontend worktree. The websocket endpoint is local/transient and intentionally not committed.

`DATABASE_URL=postgresql://whr:whr@127.0.0.1:5433/whr_app6_client_smoke pnpm exec playwright test --config /private/tmp/whr-client-smoke-browser.config.mts --reporter=line`

No export check, server/shared contract, service worker, or STATUS/coverage/lane file was edited. A one-line escaped-bug gotcha was added to the existing frontend agent file through the normal patch tool without a permission denial or bypass.
