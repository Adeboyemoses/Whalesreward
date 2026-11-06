# Local admin navigation BEFORE / AFTER comparison

WO-app-4a / WHR-75. Application BEFORE `6072636`; AFTER `4e87ed7`. Corrected BEFORE producer `f106552`; AFTER harness `9ee4935`. All values below are local fixture-stack CDP emulation, not staging observations. AFTER measurement suite: **2 passed (33.1 seconds)**, one worker, zero retries. No concurrent heavy gates ran during capture.

## Profiles and fixture comparability

- CDP 150 ms request latency; unlimited download/upload throughput (-1). This is the representative emulation profile, not a measured staging RTT.
- Fast3G-shaped stress: latency 562.5 ms, download 200,000 bytes/s, upload 93,750 bytes/s; same browser and 1440 × 1000 viewport.
- BEFORE cardinalities were reconstructed from immutable creation times against raw first-focus timestamps: 11 admins/one Owner role in the first profile; 12/one in the second. AFTER used fresh `whr_admin_nav_after_final`, seeded with ten admins/one Owner role before the first per-profile fixture. The first fixture made 11 admins and the second made 12. No accumulated custom reporting roles from regression runs were used. `prepare-fixture-shape.ts` reproduces the padding with fictional records and no login credentials for padding accounts.
- Sign-in/bootstrap happens before throttling. Each profile starts on Users; samples then repeat tab return, user detail, back to Users, change section, Owner role detail, back to Users. The three samples therefore include initial route visits and warm revisits. No sample is dropped or smoothed.

## All readiness samples (ms)

| Profile | Operation | BEFORE samples | AFTER samples |
|---|---|---|---|
| rtt150 | tab-return | 487.9, 476.6, 482.2 | 3.2, 0.8, 0.9 |
| rtt150 | user-open | 852.2, 839.9, 842.2 | 333.3, 321.4, 322.2 |
| rtt150 | role-open | 665.9, 691.1, 690.4 | 323.4, 333.9, 329.9 |
| rtt150 | section-change | 674, 672.1, 670.2 | 335.5, 161.1, 160.2 |
| fast3g-shaped | tab-return | 1815.8, 1806.7, 1818.1 | 2.4, 3.6, 1.9 |
| fast3g-shaped | user-open | 2949.6, 2956.2, 2943.5 | 1656.6, 1201.4, 1188.3 |
| fast3g-shaped | role-open | 2375.6, 2375.5, 2360.8 | 1187.5, 1184.6, 1181.9 |
| fast3g-shaped | section-change | 2394.7, 2358.2, 2367.9 | 1184.2, 604.6, 599.1 |

The representative 150 ms profile meets tab return <300 ms and full user/role readiness <1 second. Stress-profile tab return also meets <300 ms, but **full user/role readiness still exceeds one second** (user 1188.3–1656.6 ms; role 1181.9–1187.5 ms). No stress-profile one-second success is claimed. The first stress user visit is retained as the slowest sample.

Every BEFORE section/detail navigation created one new document; every AFTER action created zero. All discard flags were false in this local run. This proves the corrected local client does not discard/reload its document for those actions; it makes no claim about Chrome Memory Saver on Earl’s actual device.

## Readiness, context and instrumentation limits

The semantic readiness predicates match BEFORE: list heading plus rows, user detail heading plus populated role picker, or all 28 role-permission inputs. AFTER additionally tags nonsecret random document-lifetime markers and fixture counts. The observer now also emits when a new route category is continuously ready: healthy cached sections no longer transition through false, so this is needed to observe their destination without inventing a blank. That extension does not change full-document BEFORE readiness or its captured numbers. The initial AFTER harness attempt could not emit a mark for a continuously ready section and produced no completed timing artifact; the complete corrected run above is the comparison evidence.

Raw event timestamps, coarse route categories and all samples are retained in the JSON. Destination category prevents a late outgoing-ready mark ending an incoming interval. Full-document BEFORE uses its document-start event timestamp to identify lifetime; AFTER adds random lifetime markers. Starts are outgoing click marks (browser pre-dispatch timestamp fallback on unload), or focus marks for return. Incoming focus never starts a navigation interval.

`blankMs` is a readiness-gap field, **not a full-screen blank metric for every route**. AFTER tab-return gaps are zero, versus 474.8–485.0 ms / 1805.7–1817.4 ms BEFORE. AFTER detail gaps mean the destination form is not yet ready while the existing list context and shared shell remain visible; deterministic held-response tests verify that context. Cross-document BEFORE zero means its same-document observer did not survive unload, not zero blank time. These are DOM-readiness measurements, not a pixel filmstrip.

No identity, email, entity identifier, credential, response body or token is included in measurement output. Random document-lifetime UUIDs are diagnostic labels only. Browser traces, video and automatic screenshots remain disabled.

## Reproduce AFTER

Use a new isolated `whr_admin_nav_*` database and the retained Linux runner with tracked source only:

```sh
git archive HEAD | docker exec -i whr-admin-navigation-tests tar -xf - -C /verify
docker exec -w /verify \
  -e DATABASE_URL=postgresql://whr:whr@host.docker.internal:5433/whr_admin_nav_after_fresh \
  -e WHR_TIMING_PHASE=after -e WHR_TIMING_SOURCE=4e87ed7 \
  whr-admin-navigation-tests sh -c 'pnpm db:migrate:deploy && pnpm db:seed && node tests/admin-navigation/prepare-fixture-shape.ts && pnpm exec playwright test -c tests/admin-navigation/playwright.config.ts'
```

Create that named database locally first; preparation refuses populated shapes other than one seeded admin or ten prepared admins. No data deletion is performed. Local credentials above are public Compose fixtures. Do not use deployed services or private runtime files.
