# Local admin navigation BEFORE timings

WO-app-4a / WHR-75. Application source `6072636` is unchanged; measurement harness producer `f106552`. Earl superseded live staging measurement with the local fixture stack. These values are **local CDP emulation**, not measured staging RTT or deployed performance. Browser viewport 1440 × 1000, local Linux Chromium, real PostgreSQL, production Next build, one worker, zero retries. Both measurement cases passed (1.3 minutes).

## Exact profiles

- `rtt150`: CDP request latency 150 ms; download/upload throughput -1 (unlimited). The name is a profile label, not a measured RTT.
- `fast3g-shaped`: CDP latency 562.5 ms, download 200,000 bytes/s, upload 93,750 bytes/s. This is an explicitly shaped stress profile, not a claim that every Fast 3G connection has these values.

## All samples (milliseconds)

| Profile | Operation | Sample 1 | Sample 2 | Sample 3 | New documents per sample |
|---|---|---:|---:|---:|---|
| rtt150 | tab-return | 487.9 | 476.6 | 482.2 | 0, 0, 0 |
| rtt150 | user-open | 852.2 | 839.9 | 842.2 | 1, 1, 1 |
| rtt150 | role-open | 665.9 | 691.1 | 690.4 | 1, 1, 1 |
| rtt150 | section-change | 674 | 672.1 | 670.2 | 1, 1, 1 |
| fast3g-shaped | tab-return | 1815.8 | 1806.7 | 1818.1 | 0, 0, 0 |
| fast3g-shaped | user-open | 2949.6 | 2956.2 | 2943.5 | 1, 1, 1 |
| fast3g-shaped | role-open | 2375.6 | 2375.5 | 2360.8 | 1, 1, 1 |
| fast3g-shaped | section-change | 2394.7 | 2358.2 | 2367.9 | 1, 1, 1 |

Tab-return same-document content-absent intervals were 485.0 / 474.8 / 480.4 ms for the 150 ms profile, and 1814.6 / 1805.7 / 1817.4 ms for the stress profile. All `document.wasDiscarded` readings were false. Focus causes no document navigation but removes/recreates authorized content; every measured page/detail click causes a new document. This locally reproduces app-driven blanking/reloads, not browser Memory Saver discarding. It does not diagnose Earl’s actual browser discard history.

## Timing method and limits

A document-start MutationObserver emits only event kind, high-resolution epoch timestamp, coarse route category and discard flag to a Playwright binding. Categories contain no user/role IDs. Visible readiness means the appropriate list heading and rows, user-detail heading and populated role selector, or all 28 role-permission checkboxes. Outgoing readiness marks cannot end an incoming navigation measurement because the expected destination category must match. A `document` event timestamp identifies each incoming document lifetime in the raw timeline.

Start is the outgoing click mark; fallback is a browser-side timestamp immediately before Playwright dispatch if the outgoing binding is lost on unload. Incoming focus events never become navigation starts. Tab-return uses a dispatched focus event and observes readiness disappearance/reappearance, with animation-frame checking. It is a deterministic local focus return simulation, not a physical OS tab-discard experiment.

Raw JSON retains every sample and numeric event timeline; none were dropped or smoothed. `blankMs` records same-document MutationObserver gaps only: zero in cross-document navigation means no such mark survived unload, **not** zero user-visible blank time. Cross-document click-to-destination-ready and the new-document count are the valid navigation metrics. This is a DOM readiness measurement, not a filmstrip/pixel proof.

No credentials, inboxes, tokens, entity IDs, response bodies or private runtime files are recorded. Secret-bearing traces/video/automatic screenshots are disabled. The historical failed draft timing runs were discarded because their readiness correlation was invalid; only the corrected complete run above is evidence.

## Reproduce

Use retained runner `whr-admin-navigation-tests`, `/verify`, local database `whr_admin_nav_test`, with tracked source only. Do not run against deployed services.

```sh
git archive HEAD | docker exec -i whr-admin-navigation-tests tar -xf - -C /verify
docker exec -w /verify \
  -e DATABASE_URL=postgresql://whr:whr@host.docker.internal:5433/whr_admin_nav_test \
  whr-admin-navigation-tests pnpm exec playwright test -c tests/admin-navigation/playwright.config.ts
```

For AFTER output, set `WHR_TIMING_PHASE=after` and `WHR_TIMING_SOURCE` to the implemented source SHA. Keep the profiles, viewport, readiness definitions and fixture stack identical. The timings config is opt-in and does not put performance targets into ordinary CI.
