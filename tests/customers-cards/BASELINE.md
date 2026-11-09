# WO-app-6 local browser baseline

Runtime: approved pre-feature head `a61cfdbc51e904cdefdf68da6fc10c290bd9a086`. Independent checker, Linux Chromium/Node 26 in `whr-customers-app-tests`, isolated fictional PostgreSQL database `whr_app6_customers`, real local MinIO/Mailpit Compose services. No staging/cloud/provider data or secret files. Browser traces/video/automatic screenshots disabled; fixture identities are fictional.

Command: `pnpm exec playwright test --config tests/customers-cards/playwright.config.ts --project=desktop --grep 'online registration links|customers search|card generation starts' --reporter=line`.

Real output: **3 failed, 0 passed, 0 skipped, zero retries**. Registration provisioned and signed in a real fresh attendant and generated/printed/activated real unused cards before failing on the absent Register customer heading. Both admin cases signed in enabled unrestricted fictional Owner accounts before failing on absent Customers and Generate headings. These are pre-feature UI failures with valid API preconditions.

Preparatory harness attempts are excluded from product red evidence: incomplete Linux optional native package cache, then stale failed build cache, then corrected TypeScript test producer; macOS Chromium launch was denied by MachPortRendezvous before application assertions. Exact locked Linux native packages were materialized in the isolated runner without dependency/lockfile changes. Tests retain standard timeouts, quotas and assertions, use stable per-account RFC3849 documentation IPs through the existing local-only trusted header, and do not reset rate buckets.

D08 fixture configuration: explicit proposed Nigerian mobile normalizer and fictional 210×297 mm page /85.6×54 mm cards /10 mm margin /2 mm gap print layout. These are local renderer inputs, not physical-print or pilot acceptance. Actual API success remains separate from deliberate lost/delayed-response transport probes.
