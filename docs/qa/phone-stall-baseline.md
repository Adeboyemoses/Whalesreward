# Phone-stall baseline investigation

Part of WHR-65. Status: ACCEPTED by Earl; closeout under the instruction below. The deployed baseline was measured before application edits. The reported 1–3 minute duration was not reproduced; the baseline client exceeded the two-second target under 3G as measured below.

## Deployed observations, 5 November 2026

- `/api/health` returned `ok: true`, `db: ok`, version `1a6316c18db51afa3584c0d959935ceae00edadf` before any application edits.
- Native Chrome's existing attendant tab was signed out. After fictional gas attendant sign-in, an observation-only DevTools probe emitted a buffered session Resource Timing duration of **477 ms**. It emitted no request body, headers, identity, cookie or token.
- The same tab reported `controlled: true`, active service worker `activated`, and waiting worker `installed`. Its displayed navigation contained Sale and Account but no Uploads, unlike the current source. Therefore this is an older controlled client with a waiting update; the health version alone does not identify its cached client build.
- A separate unauthenticated curl request to the generic sale shell returned 200: connect **1.306 s**, TLS complete **2.366 s**, first byte **3.057 s**, total **3.105 s**. This is a cold network request, not a browser transition or a capture timing.
- The user completed the initial camera permission/photo step. The initial Save caused a full navigation: destination document load **752.3 ms**, then session request **702.2 ms**, beginning at **764.1 ms**. The original observer did not survive navigation, so this sample has no claimed exact click-to-receipt total.
- On the current client, unthrottled warm Record next sale measured **778.4 ms**, from `whr:next` at 139945.4 ms to `whr:form` at 140723.8 ms. This was same-document navigation.

## Current-client 3G measurements

Native Chrome with DevTools' built-in **3G** preset and iPhone 16 emulation (393 × 852), real staging endpoints, fictional gas attendant/customer, installed generic shell. No mocked API, modified app bundle, cookie export or permission bypass. The later photo sample used the live virtual camera's non-personal placeholder image; this is a performance sample, not meter-readability or physical-phone acceptance evidence.

| Measurement | Before |
|---|---:|
| Cold cached shell response end | 33.8 ms after navigation |
| First contentful paint | 336 ms |
| Document load | 522 ms |
| Session request start | 545.7 ms |
| Session request duration | 2029.2 ms |
| Session request end | 2574.9 ms after navigation |
| Save sale → receipt | 4145.2 ms |
| Record next sale → form | 2021.9 ms |

The cold reload visibly displayed “Checking access…” before the form. Session Resource Timing entries were converted to `whr:session-start`, `whr:session-end` marks and a `whr:session-wait` measure. Save/next timings use capture-phase button click marks and a MutationObserver for receipt/form presence, with User Timing measures. Both 3G action samples stayed in the same document; their observer remained alive. The probe emitted only labels and durations, never payloads, headers, credentials or signed URLs.

## Pre-change findings and measurement limits

- `AttendantProvider` awaits online `client.refresh()` before enabling publication of local state. Its timer and online/offline listeners cannot expose that local state while initialization is pending. `HttpAttendantApi` currently has a 30-second request abort deadline.
- Workbox registers fixed-route precaching before its navigation handler. Dynamic receipt navigation reaches an unbounded network fetch, falling back only after rejection. A fixed-route result must not be mistaken for exercising this fallback.
- Offline `go()` uses full-document navigation. A console MutationObserver is destroyed on navigation; its final `pagehide` mark labels that measurement incomplete. Cross-document baseline needs a browser Performance recording or document-start instrumentation, not a late observer pretending to know the first render time.
- Read-only tracing found sync/session network awaits outside Dexie transactions. There is no source evidence for uploads holding a local transaction over network I/O.
- The warm 3G action timings identify another network dependency: Next router navigation waits for route data before rendering. The local sale and receipt shells can render from the same durable partition without that route-data dependency.
- Delayed-session and stalled-service-worker-navigation regressions fail against the unchanged local baseline. These controlled failures isolate the mechanisms; they are not presented as naturally occurring 1–3 minute staging observations.

## Local unchanged baseline

- EM: 135 unit tests passed, 22 files.
- Test-engineer: isolated Linux production build and four migrations passed; disposable local browser infrastructure prepared. No production, server or test source changes.

The smoke runbook is `docs/qa/smoke-2026-11-05-phone-stall.md`. The original plan called for repeated desktop measurements after deployment; the accepted closeout instruction below supersedes that requirement.

## Implemented cause and verification

Feature PR #49 merged at `d3481fc6e39dabe8ab5e087ee581b91d891f56ed`; deployed health later reported that exact version with `db: ok`.

The review found a third network dependency: Save repeated the already-resolved card lookup and awaited it before the durable write. A browser test holding every subsequent lookup failed its two-second receipt deadline on both profiles before the fix and passed both afterward. The same lookup now runs in the background; its delayed authentication, permission and assignment denials still lock the originating context. Local access/context checks run again inside the final write transaction. Only the server can validate the card and award credit.

The other changes publish the checked durable session before background revalidation, use the shared sale/receipt shell for capture navigation, and return the generic precached shell after a 1200 ms navigation deadline, including stalled response bodies. The original 24-hour anchor, request authority deadlines, immutable sale/photo, account partition and exact calculation rules remain unchanged.

The final combined verification is recorded in `phone-smoke-regressions.md`. The service-worker deadline is distinct from cold hydration: one controlled local test committed its fallback document within two seconds but displayed the complete receipt at 2250.3 ms. Save and next-sale retain their two-second end-to-end assertions.

## Accepted phone rerun and closeout, 5 November 2026

Earl explicitly instructed: “Earl accepted the phone rerun (see WHR-65). Close WO-app-3b (WHR-65), WO-app-3 (WHR-7) and WO-app-2 (WHR-5) through close-session, then stop.” This supersedes the earlier READY-only instruction and its “physical Samsung acceptance pending Earl's rerun” caveat.

Rook's 20:36 UTC comment on [WHR-65](https://linear.app/phaneum/issue/WHR-65) records Earl's Samsung S25 acceptance after PR #49: lag gone, faster capture, quick offline response and visible sale reference. Results were not stored on the M1 Phone Test page; Earl's in-session acceptance is the record. No numeric Samsung or deployed after-performance timings are claimed. Rook's prior instruction against Computer Use timings remains in force. Automated Save/next assertions remain two seconds; the separate M1 Phone Test page uses a three-second physical acceptance threshold.

Deployed feature commit: `d3481fc6e39dabe8ab5e087ee581b91d891f56ed`, verified by health with `db: ok`. [Closeout PR #52](https://github.com/Adeboyemoses/Whalesreward/pull/52) records acceptance of all three work orders and the M1 phone exit; Linear moves them to Done after its reviewed green staging merge. No additional implementation or work order starts here.
