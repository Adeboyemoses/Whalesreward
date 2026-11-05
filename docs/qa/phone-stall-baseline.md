# Phone-stall baseline investigation

Part of WHR-65. Status: incomplete baseline; application code remains unchanged. These observations do not establish the reported 1–3 minute stall or satisfy READY.

## Deployed observations, 5 November 2026

- `/api/health` returned `ok: true`, `db: ok`, version `1a6316c18db51afa3584c0d959935ceae00edadf` before any application edits.
- Native Chrome's existing attendant tab was signed out. After fictional gas attendant sign-in, an observation-only DevTools probe emitted a buffered session Resource Timing duration of **477 ms**. It emitted no request body, headers, identity, cookie or token.
- The same tab reported `controlled: true`, active service worker `activated`, and waiting worker `installed`. Its displayed navigation contained Sale and Account but no Uploads, unlike the current source. Therefore this is an older controlled client with a waiting update; the health version alone does not identify its cached client build.
- A separate unauthenticated curl request to the generic sale shell returned 200: connect **1.306 s**, TLS complete **2.366 s**, first byte **3.057 s**, total **3.105 s**. This is a cold network request, not a browser transition or a capture timing.
- The fictional sale form has a resolved fixture card and an amount entered. Chrome's required camera permission is pending explicit one-time confirmation. Save-to-receipt and next-sale-to-form have **not yet been measured**.

## Source hypotheses to verify

- `AttendantProvider` awaits online `client.refresh()` before enabling publication of local state. Its timer and online/offline listeners cannot expose that local state while initialization is pending. `HttpAttendantApi` currently has a 30-second request abort deadline.
- Workbox registers fixed-route precaching before its navigation handler. Dynamic receipt navigation reaches an unbounded network fetch, falling back only after rejection. A fixed-route result must not be mistaken for exercising this fallback.
- Offline `go()` uses full-document navigation. A console MutationObserver is destroyed on navigation; its final `pagehide` mark labels that measurement incomplete. Cross-document baseline needs a browser Performance recording or document-start instrumentation, not a late observer pretending to know the first render time.
- Sync network calls and local access transactions must be traced separately before blaming a lock or upload queue.

## Local unchanged baseline

- EM: 135 unit tests passed, 22 files.
- Test-engineer: isolated Linux production build and four migrations passed; disposable local browser infrastructure prepared. No production, server or test source changes.

The smoke runbook is `docs/qa/smoke-2026-11-05-phone-stall.md`. Add exact before/after performance measurements, active-client identity, controlled network profiles, and root-cause conclusions only after observing them.
