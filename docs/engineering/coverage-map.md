# Coverage map

Where each requirement stands. The EM updates the rows its work order touched at session close (`close-session` skill). Status: `todo` → `building` → `on-staging` → `accepted`. A row reaches `on-staging` only with a named test (invariants) or a design-parity check (boards).

## WO-spec-1 documentation status (WHR-32)

Data-model PR #4 is merged on staging with independent security and integrity PASS verdicts. M1 contracts PR #5 is merged with independent security and integrity PASS verdicts; lane setup and closeout complete when PR #1 merges. These are specification changes only: no invariant implementation or built-screen parity is claimed; test and board statuses remain unchanged.

## WO-spec-3 documentation status (WHR-46)

[M3 contracts](contracts/m3.md) and model additions specify corrections/midnight, independent holds and duplicate decisions, customer identity changes, scoped queue recovery and audit. Invariants addressed: I-03/I-05a/I-06–I-11, I-15–I-17/I-19/I-21/I-21a, I-22–I-41, I-42/I-44/I-45a/I-46/I-48–I-51. Board inputs: A09–A11/A14/A19–A22, B03/B04, C02–C05, G01–G05, S01–S04/S06/S07/S09. Specification merged in PR #16 with green CI and independent code/security/integrity PASS. Earl accepted it on 4 November 2026. Documentation status: accepted; closeout PR #21. WHR-39 and WHR-47–50 remain explicit implementation policy gates. WHR-38 has the P-18 build default, pending Q-528 client confirmation. No implemented invariant, test result or screen parity is claimed; the rows below keep their current statuses.

## WO-spec-3a documentation status (WHR-52)

M1/M3 and model amendments specify P-18 bounded capture and P-19 independent recovered-correction review. PR #23 merged at 6663001 with green CI and independent code/security/integrity PASS. Earl accepted WO-spec-3a on 4 November 2026. Documentation status: accepted; this closeout takes effect on green staging merge. No implementation or board parity is claimed. WHR-51 follows this closeout.

## WO-spec-4 documentation status (WHR-51)

[M4 contracts](contracts/m4.md) define 26 endpoint interfaces and model additions for overall/category ranking, frozen giveaway review/results/revisions, daily/product/attendant/pump reports and PDF/Excel exports, overview KPIs/attention, and reviewed timing/retention intent. Specification status: ACCEPTED by Earl on 5 November 2026. PR #27 merged at 71f3e68 with code/security/integrity PASS and all five CI checks green; WHR-51 moves to Done after this reviewed documentation closeout merges. WHR-52 is accepted and closed through PR #26. No implementation test or board parity is claimed.

WHR-54/55/56 track reconciliation/upload proof, launch/start/timing changes and photo removal. Null client values, blocked unsupported finalization and disabled deletion preserve data. P-18/Q-528 and M3 gates remain in force. Required downstream tests are listed in M4; actual test names and parity reports belong to implementation work orders.

## WO-spec-3b documentation status (WHR-61)

P-20 refines P-18 in M1/M3, the data model and I-45a: capture interval [S, min(R, original offlineExpiresAt)] and evidence-backed capture review with sales AND dateReview. Documentation status: ACCEPTED by Earl on 5 November 2026. [PR #38](https://github.com/Adeboyemoses/Whalesreward/pull/38) merged at 5304f34 with green CI and independent code/security/integrity PASS. WHR-61 moves to Done after this reviewed documentation closeout merges. Q-528 remains pending. Acceptance covers the specification; implementation coverage and board-parity statuses remain unchanged.

WO-core-4a must verify late receipt, changes after versus at/before U, exact expiry, immutable bounds on retry/recovery, and receipt-based upload deadlines. WO-core-9 must verify capture confirm/cancel, insufficient evidence, permission conjunction/revocation, Domain replay, stale/concurrent guards, independent holds and retained resolutions. WO-core-4a adds the capped-policy implementation tests below; capture review remains WO-core-9. S03/S06/S07 remain visual inputs only; no capture-review board is invented.

## Invariants

WO-spec-2 / WHR-40 specifies M2 interfaces in `contracts/m2.md` and supporting model additions. Scope: I-01/I-02, I-04/I-05/I-05a, I-07–I-20, I-29/I-31/I-32, I-41/I-49/I-50; F08/I-21/I-21a are preservation boundaries, not recovery implementation. Board inputs: attendant rows 4/7; admin rows 1–3, 6 (C01/B05/S08 reads only), 7–10 and 15–16 (H07 permission projection only). Specification closeout takes effect when the spec/wo-2-m2-contracts PR merges into staging with green CI; independent committed-head review and the merged PR are recorded on WHR-40. This is documentation coverage only; all implementation test and board-parity statuses below remain unchanged.

| ID | Rule (short) | Work order | Test | Status |
|---|---|---|---|---|
| I-01 | Each attendant has a personal account: name, unique username, password and a permanent sys… | WO-core-3 (server); WO-core-6 (M2 backend) | attendant-auth.test.ts: personal credentials/context; attendant-auth.spec.ts: real sign-in; station-management.test.ts: I-01 first password sessions cannot capture; credential control/Unicode roundtrips; station-adversarial.test.ts: cross-kind username collision and zero partial account | on-staging (M2 backend READY; first-password UI WHR-77 pending) |
| I-02 | Sign-in, account switching and customer registration need connectivity | WO-app-2 (client); WO-core-3 (server) | tests/e2e/offline-capture.spec.ts (handover; client scope); see authentication coverage below | building |
| I-03 | Offline capture is allowed for 24 hours after the last successful online sign-in | WO-app-2 (client); WO-core-3 (server); WO-core-4 (server); WO-spec-3b (spec only); WO-core-4a; WO-app-3 (client) | src/client/offline/window.test.ts; offline-capture.spec.ts (24h, rollback, restart); see authentication coverage below; sync-sales.test.ts: exact24h write/read boundary; P-20 capped capture interval (capture-policy.test.ts); Monday outage, expiry microseconds and unchanged v1 hold replay (sync-sales.test.ts); sync.test.ts: 24h upload pause; upload-sync.spec.ts: account/window guards | building |
| I-04 | An account writes only for its authorized station and pump | WO-core-3 (server); WO-core-6 (M2 backend) | see authentication coverage below; station-adversarial.test.ts: I-04 restricted first-password sessions have no capture context and cannot use configured assignment or sync | on-staging (M2 backend READY; first-password UI WHR-77 pending) |
| I-05 | Pump reassignment is done by an authorized admin | WO-core-3 (server); WO-core-6 (M2 backend) | see authentication coverage below; station-management.test.ts: I-05 concurrent reassignments close one interval; fresh sign-in acknowledges new pump without rewriting old context | on-staging (M2 backend READY; first-password UI WHR-77 pending) |
| I-05a | A queued record from before a reassignment is validated against that account's assignment … | WO-core-4; WO-core-3; WO-spec-3b (spec only); WO-core-4a; WO-core-6 (M2 backend) | sync-sales.test.ts: P-18 reauthentication; simultaneous assignment/price/campaign conditions; P-20 capped capture interval (capture-policy.test.ts); Monday outage, expiry microseconds and unchanged v1 hold replay (sync-sales.test.ts); station-management.test.ts: P-20 assignment change inside=true/false capped [S,U] preserves old queue ownership and attribution | on-staging (server slice; effective on reviewed green merge); M2 backend regression on-staging |
| I-06 | Logout offers upload-first when connected | WO-app-2 (client); WO-core-3 (server); WO-core-4 (server); WO-app-3 (client) | offline-capture.spec.ts (handover, cross-tab); client.test.ts (failed revocation); see authentication coverage below; sync-sales.test.ts: foreign account read/upload/finalize isolation; upload-sync.spec.ts: account handover, upload-first, Stay signed in and navigation cancellation | building |
| I-07 | Admin users, roles and permissions are separate from attendant accounts | WO-core-5; prior M3/M4 specs; WO-app-4 (client); WO-core-6 (M2 backend) | admin-access-adversarial.test.ts: I-07 every protected access route denies a live zero-grant account; I-07 surface cookies, cross-origin requests and oversized JSON cannot authorize; admin-access.spec.ts (default and dedicated local-stack suites), admin-api.test.ts (no-store), final report below; station-adversarial.test.ts: grant separation, security-lock revocation, replay reauthorization and scoped cursors | on-staging (admin access); WO-app-4 client scope accepted 6 Nov 2026; M2 backend regression on-staging |
| I-08 | At least one active Owner always exists | WO-core-5; WO-app-4 (client) | admin-access-adversarial.test.ts: I-08 two concurrent Owner self-demotions leave exactly one active Owner; admin-access.spec.ts (default and dedicated local-stack suites), admin-api.test.ts (no-store), final report below | on-staging; WO-app-4 client scope accepted 6 Nov 2026 |
| I-09 | Disabling an account or removing a permission revokes it on active sessions | WO-app-2; WO-core-3/4/5; prior M3/M4 specs; WO-app-4 (client); WO-core-6 (M2 backend) | Existing attendant/sync revocation coverage retained; admin-access-adversarial.test.ts: I-09 removing a role permission revokes every existing member session; I-09/I-12 disabling then reenabling an admin never restores its old recovery link; admin-access.spec.ts (default and dedicated local-stack suites), admin-api.test.ts (no-store), final report below; station-management.test.ts: I-09 disabled accounts lose live session and cannot accept new assignments (no status endpoint added) | on-staging; WO-app-4 client scope accepted 6 Nov 2026; M2 backend regression on-staging |
| I-10 | A role administrator cannot grant more authority than they hold | WO-core-5; WO-app-4 (client) | admin-access-adversarial.test.ts: I-10 delegation checks the existing target role before a lower-role disable; I-10 non-Owner with all grants still cannot promote an Owner and Owner role is immutable; admin-access.spec.ts (default and dedicated local-stack suites), admin-api.test.ts (no-store), final report below | on-staging; WO-app-4 client scope accepted 6 Nov 2026 |
| I-11 | Sensitive actions are independent grants with their required views | WO-core-5; prior M3/M4 specs; WO-app-4 (client) | admin-access-adversarial.test.ts: I-07/I-11 exposes exactly 28 independent action permissions and no legacy aliases; I-11 incomplete permission dependencies fail without implicit grants; admin-access.spec.ts (default and dedicated local-stack suites), admin-api.test.ts (no-store), final report below | on-staging (catalogue and access management); WO-app-4 client scope accepted 6 Nov 2026 |
| I-12 | Admin recovery uses verified email and single-use purpose-bound links | WO-core-5/5a/5b/5c; WO-app-4 (client) | admin-access-adversarial.test.ts: I-12 public recovery responses and same-key dedup reveal no account state; I-12 resend invalidates earlier links and current address and expiry remain authoritative; I-12 reset consumes once, revokes every session and queues a secret-free security notification; admin-access.spec.ts (default and dedicated local-stack suites), admin-api.test.ts (no-store), final report below | on-staging (admin email accepted); WO-app-4 client scope accepted 6 Nov 2026 |
| I-13 | New admins must change their temporary password before portal access | WO-core-5/5a; WO-app-4 (client) | admin-access-adversarial.test.ts: I-13 restricted sessions cannot access admin data and first-password racing succeeds once; I-13 fictional admin seed is insert-only, preserves first-password state and refuses production; admin-access.spec.ts (default and dedicated local-stack suites), admin-api.test.ts (no-store), final report below | on-staging; WO-app-4 client scope accepted 6 Nov 2026 |
| I-14 | Registration captures name, phone and a fixed category: car owners, commercial bus drivers… | WO-spec-4 (spec only) | Not implemented | todo |
| I-15 | Phone numbers are normalized before the uniqueness check | | | todo |
| I-16 | Card codes are unique across all batches, collision-retried, reserved before print export … | | | todo |
| I-17 | QR scan and typed code resolve the same card | WO-core-4 (server); WO-app-2 (client) | sync-sales.test.ts: I-17/I-50 code and QR lookup; offline-capture.spec.ts (QR/typed) | on-staging (effective on reviewed green merge) |
| I-18 | Batch lifecycle is Generated → Printed → Active, forward only, server-validated, audited w… | | | todo |
| I-19 | A card can be linked only when its batch is Active and the card is unassigned and not reti… | | | todo |
| I-20 | PDF print sheets and Excel registers are generated from the reserved codes | | | todo |
| I-21 | Card replacement keeps the customer and retires the old card atomically | | | todo |
| I-21a | Before replacing a lost card, the admin verifies a code sent to the registered phone (thro… | | | todo |
| I-22 | Every sale has a client-generated operation ID | WO-core-4; WO-spec-3b (spec only); WO-core-4a; WO-app-3 (client) | sync-sales.test.ts: lost-response retry; changed original content; concurrent finalize; changed finalize body; P-20 capped capture interval (capture-policy.test.ts); Monday outage, expiry microseconds and unchanged v1 hold replay (sync-sales.test.ts); sync.test.ts and upload-sync.spec.ts: lost submit/finalize reconciliation and original ID replay | on-staging (effective on reviewed green merge) |
| I-23 | The sale and its photo blob are saved atomically in IndexedDB before the phone shows "Save… | WO-app-2 (client); WO-app-3 (client) | offline-capture.spec.ts (offline restart, quota); client.test.ts (atomic save); upload-sync.spec.ts: restart and retained original/photo; offline-capture.spec.ts: atomic save | on-staging |
| I-24 | Photos come from the live in-app camera only | WO-app-2 (client) | offline-capture.spec.ts (denied camera); client.test.ts (photo digest) | on-staging |
| I-25 | Uploads go to a unique staging path through a short-lived signed permission scoped to that… | WO-core-4; WO-app-3 (client) | sync-sales.test.ts: adversarial evidence; invalid/oversized decode; expired permission; real MinIO CORS; storage.test.ts; sync.test.ts, sync-api.test.ts and upload-sync.spec.ts: partial PUT, expired permission and permanent photo rejection | on-staging (server; deployed Spaces smoke pending) |
| I-26 | Credit needs: resolved customer, complete details, validated photo, price checks and eligi… | WO-core-4; WO-spec-3b (spec only); WO-core-4a; WO-app-3 (client); WO-core-6 (M2 backend) | sync-sales.test.ts: concurrent finalize; revoked during storage; failed final-object write; P-18 mixed conditions; P-20 capped capture interval (capture-policy.test.ts); Monday outage, expiry microseconds and unchanged v1 hold replay (sync-sales.test.ts); sale-presentation.test.ts and upload-sync.spec.ts: no Synced before authoritative credit; station-price-visibility.test.ts: I-31/I-32 P-20 in-interval rate change waits for activation commit then credits only uniform history | on-staging (effective on reviewed green merge); M2 backend regression on-staging |
| I-27 | A definitive "customer not found" cancels the record with a reason | WO-core-4; WO-app-3 (client) | sync-sales.test.ts: definitive unknown card; transient lookup failure; upload-sync.spec.ts: authoritative cancellation with retained missing photo and visible reason | on-staging (effective on reviewed green merge) |
| I-28 | Store app capture time and server receipt time separately | WO-core-4; WO-spec-3b (spec only); WO-core-4a; WO-app-3 (client); WO-core-6 (M2 backend) | sync-sales.test.ts: lost-response retry; reauthentication; transient lookup preserves first receipt; P-20 capped capture interval (capture-policy.test.ts); Monday outage, expiry microseconds and unchanged v1 hold replay (sync-sales.test.ts); sync.test.ts: original/finalize preservation; receipt.tsx uses original capture time; station-price-visibility.test.ts: all three COMMIT-barrier cases assert original receipt unchanged after activation visibility wait | on-staging (effective on reviewed green merge); M2 backend regression on-staging |
| I-29 | Amount entry is the default; Quantity entry is available | WO-app-2 (client); WO-spec-4 (spec only); WO-core-6 (M2 backend) | client.test.ts (exact money); offline-capture.spec.ts (gas quantity); station-management.test.ts: I-32 precision-only activation is versioned; no-change, overflow and stale confirmations do not write; captured values preserved | building; M2 backend regression on-staging |
| I-30 | Liquids offer Bought into: Vehicle, Keg, Three-wheeler, Bike | WO-app-2 (client) | client.test.ts and offline-capture.spec.ts (gas cylinder) | building |
| I-31 | A sale is held for price review, with zero credit, only when its captured rate is an unres… | WO-core-4; WO-spec-3b (spec only); WO-core-4a; WO-app-3 (client); WO-core-6 (M2 backend) | sync-sales.test.ts: uniform history/precision-only changes; price boundary holds zero credit through retry; P-20 capped capture interval (capture-policy.test.ts); Monday outage, expiry microseconds and unchanged v1 hold replay (sync-sales.test.ts); sale-presentation.test.ts and upload-sync.spec.ts: price hold remains uncredited; station-price-visibility.test.ts: paused-COMMIT rate/precision/outside-U controls; station-management.test.ts: P-20 price activation inside=true/false | on-staging (price hold; resolution remains later scope); M2 backend regression on-staging |
| I-32 | Price activation is immediate on server confirmation, one price per product for the statio… | WO-spec-4 (spec only); WO-core-6 (M2 backend) | Not implemented; station-management.test.ts: I-32 concurrent price activations have one winner and never rewrite old price versions; precision-only/no-change/stale controls | todo; M2 backend regression on-staging |
| I-33 | A sale uploaded against a card replaced before upload is held for card-eligibility review … | WO-app-3 (client) | upload-sync.spec.ts: mixed card hold remains uncredited (client display only) | building (client hold display on staging; review/resolution remains later scope) |
| I-34 | A sale with an unreliable capture date is held until an admin records an evidence-supporte… | WO-spec-3a (spec only); WO-spec-4 (spec only); WO-spec-3b (spec only); WO-app-3 (client) | Not implemented; P-20 downstream checks above, not implemented; upload-sync.spec.ts: mixed date hold remains uncredited (client display only) | building (client hold display on staging; review/resolution remains later scope) |
| I-35 | Each hold (price, card, date) clears only itself | WO-spec-3a (spec only); WO-spec-4 (spec only); WO-spec-3b (spec only); WO-app-3 (client) | Not implemented; P-20 downstream checks above, not implemented; sync.test.ts and upload-sync.spec.ts: independent mixed holds preserved (client display only) | building (client hold display on staging; review/resolution remains later scope) |
| I-36 | Admin-assisted recovery of a stranded queue happens on the original phone, with online adm… | WO-spec-3a (spec only) | Not implemented | todo |
| I-37 | An attendant's own correction received by the server before midnight (Africa/Lagos) on the… | WO-spec-3a (spec only) | Not implemented | todo |
| I-38 | An original sale arriving after midnight does not reopen editing | WO-spec-3a (spec only) | Not implemented | todo |
| I-39 | Optimistic version checks reject a correction based on an outdated revision | WO-spec-3a (spec only); WO-spec-4 (spec only); WO-spec-3b (spec only) | Not implemented; P-20 downstream checks above, not implemented | todo |
| I-40 | Retries never duplicate credit | WO-spec-4 (spec only) | Not implemented | todo |
| I-41 | Sensitive changes write immutable, secret-free actor/time/reason audit | WO-core-2/5/5a/5b/5c; prior M3/M4 specs; WO-app-4 (client); WO-core-6 (M2 backend) | Existing core-schema.test.ts append-only coverage retained; admin-access-adversarial.test.ts: I-41 pasted emails, link tokens and password assignments are absent from access audit; reset/verification/role mutation tests assert atomic audit; admin-access.spec.ts (default and dedicated local-stack suites), admin-api.test.ts (no-store), final report below; station-management.test.ts: pump creation, price activation and assignment tests assert transactional audit and historical receipt; station-adversarial.test.ts: denied writes leave no partial records | building (access implemented, admin email accepted; later domains pending); WO-app-4 client scope accepted 6 Nov 2026; M2 backend regression on-staging |
| I-42 | Qualifying totals come from each purchase's current accepted revision, excluding cancelled… | WO-spec-4 (spec only); WO-spec-3b (spec only) | Not implemented; P-20 downstream checks above, not implemented | todo |
| I-43 | Rank by exact qualifying spend | WO-spec-4 (spec only) | Not implemented | todo |
| I-44 | All-time totals are kept separate from campaign-qualifying totals | WO-spec-4 (spec only) | Not implemented | todo |
| I-45 | Purchase cutoff, upload grace period and photo retention are configurable, versioned and a… | WO-spec-4 (spec only) | Not implemented | todo |
| I-45a | Which clock decides what | WO-spec-3a (spec only); WO-spec-4 (spec only); WO-spec-3b (spec only); WO-core-4a; WO-core-6 (M2 backend) | capture-policy.test.ts: P-20 capped capture interval, campaign bounds and receipt deadline; sync-sales.test.ts: Monday outage and exact expiry; station-price-visibility.test.ts: three committed-history visibility controls preserve original [S,min(R,offlineExpiresAt)] and receipt; station-management.test.ts: four price/assignment interval regressions | building (M1 capped interval; M3 review and M4 finalization remain); M2 backend regression on-staging |
| I-46 | Finalization happens only after cutoff and grace have passed and all holds and reconciliat… | WO-spec-4 (spec only); WO-spec-3b (spec only) | Not implemented; P-20 downstream checks above, not implemented | todo |
| I-47 | Prize distribution stays manual | WO-spec-4 (spec only) | Not implemented | todo |
| I-48 | Photos live in private Spaces buckets per environment, under random paths with no names or… | WO-core-4 (upload/finalize); WO-app-3 (client) | storage.test.ts: Spaces virtual host/signing; sync-sales.test.ts: real MinIO immutable evidence; sync-api.test.ts: signed PUT credentials omitted, redirects rejected (client boundary only) | building (private upload/finalize implemented; admin signed reads and deployed smoke remain) |
| I-49 | The service worker caches only the generic capture shell and fonts | WO-app-2 (client); WO-spec-4 (spec only); WO-app-3 (client); WO-app-4 (client) | offline-capture.spec.ts (generic-only service-worker cache); offline-capture.spec.ts: generic-only service-worker cache; sync-api.test.ts: no-store network; admin-access.spec.ts (default and dedicated local-stack suites), admin-api.test.ts (no-store), final report below | on-staging; WO-app-4 client scope accepted 6 Nov 2026 |
| I-50 | Cache only minimal customer lookup data on the phone | WO-app-2 (client); WO-core-4 (server); WO-app-3 (client) | client.test.ts (account-scoped lookup); offline-capture.spec.ts (cache exclusions); sync-sales.test.ts: minimal lookup has no phone data; offline-capture.spec.ts: account-scoped lookup and cache exclusions | on-staging |
| I-51 | Retention deletion runs only under an approved policy, skips pending evidence and active h… | WO-spec-4 (spec only) | Not implemented | todo |
| I-52 | Scheduled jobs are idempotent, bounded, leased and restartable | WO-core-5b/5c; WO-spec-4 (remaining jobs spec only) | admin-mail-loop-adversarial.test.ts: competing claims, redeploy fencing, capped stale cleanup, shutdown drain, empty cadence; mail-loop/runtime unit tests and automatic-mail-lifecycle.spec.ts | building (admin mail accepted; other jobs pending) |

## WO-app-0 accepted documentation (WHR-33)

Earl accepted WO-app-0 on 5 November 2026 (“Accept WO-app-0 (WHR-33)”). Briefs and runbooks merged in PRs #2 and #9; closeout takes effect on green staging merge. Acceptance covers documentation only.

Earl’s 4 November findings: app-2/app-3 runbooks now split at local durable save versus server confirmation; row 02 includes I-03 capture/save guards and omits unavailable M2 registration navigation. These remain unexecuted drafts; coverage statuses below are unchanged.

Rows 1, 2, 3, 6 and 8 have implementation briefs and draft phone runbooks prepared against their board PNGs and decision notes. This is documentation preparation only: it implements no invariant and establishes no built-screen parity. Tests and board statuses below remain todo until the respective implementation work orders verify them. Proposed M1 contract names remain TODO-CONTRACT pending WO-spec-1.

## WO-core-3 authentication coverage (WHR-4)

Backend scope becomes READY on reviewed green staging merge of [PR #30](https://github.com/Adeboyemoses/Whalesreward/pull/30). `tests/integration/attendant-auth.test.ts` verifies actual Better Auth credentials and PostgreSQL sessions, and checks the real response against the existing client schema. `tests/e2e/attendant-auth.spec.ts` exercises the real sign-in/account/sign-out flow. This work claims no screen parity, browser queue implementation, purchase authorization/credit or admin permission enforcement.

| Backend boundary | Invariants supported | Named integration tests | Status |
|---|---|---|---|
| Personal credentials and acknowledged assignment/product/price | I-01/I-02/I-04 | I-01/I-02 returns attendant identity and exact assignment/product/price with no credentials; missing assignment returns 422 without committing a session or context | verified; READY on green staging merge |
| Immutable capturing sign-in and same-key replay | I-03/I-05a, WO-spec-3a lower bound | I-03 concurrent credential-validated replay creates one immutable anchor/context; expired retry tombstone cannot renew the anchor; I-03 session reads after the exact 24-hour boundary preserve the expired offline anchor | implemented; server boundary only |
| Reassignment and fresh sign-in | I-05/I-05a | I-05/I-05a retains acknowledged assignment and context until fresh sign-in; price refresh changes future price only, leaving the capture context and sign-in anchor intact | implemented; historical sale validation remains WO-core-4 |
| Session revocation and account isolation | I-06/I-09 | I-06/I-09 logout revokes immediately, preserves context and refuses replay; I-09 checks live enabled status and auth version on each request; I-09 refuses disabled, unknown, wrong-password and admin users identically | implemented; no admin permission coverage |
| HTTP and throttling | I-01/I-09 | HTTP enforces origin, strict input, secure host-only cookie, no-store and generic errors; rate limits are durable and concurrent token consumption is atomic | verified; READY on green staging merge |

Behavior inputs A01/A26/A12/A13 were inspected. A26's admin-unlock lockout text differs from the normative M1 temporary throttling contract; the backend follows M1. No new board-parity status is claimed.

## WO-core-2 foundation coverage (WHR-3)

Earl accepted WO-core-2 on 4 November 2026. Database constraints and pure helpers support the following invariants; they do not establish complete feature coverage. Their existing invariant rows remain todo until the relevant services and client flows are implemented and verified. No board parity is claimed.

| Foundation | Invariants supported | Named tests | Status |
|---|---|---|---|
| Exact kobo and captured-precision quantity arithmetic | I-29 | src/shared/money.test.ts; src/shared/quantity.test.ts | accepted |
| Explicit Lagos receipt/midnight helper | I-37, I-38 | tests/time/lagos.time.test.ts (UTC and America/New_York) | accepted |
| Unit-separated quantities | I-44 | src/shared/quantity.test.ts | accepted |
| Entity storage, normalized-phone uniqueness, fixed categories and product units | I-14, I-15, I-29, I-30 | tests/integration/schema-contract.test.ts | accepted |
| Immutable originals, append-only audit and operation uniqueness | I-22, I-28, I-41 | tests/integration/core-schema.test.ts | accepted |

## Hi-fi boards (106, in canvas row order)

| Row | Boards | Work order | Parity check | Status |
|---|---|---|---|---|
| Attendant 1 · Sign in and account | A01 A26 A12 A13 | WO-app-2, WO-core-3 | offline-capture-fidelity.md (client); upload-sync.spec.ts (upload-first behavior only) | building |
| Attendant 2 · Record a sale (online) | A02 A24 A03 A04 | WO-app-2, WO-app-3 | offline-capture-fidelity.md (A02/A24/A03); upload-sync-fidelity.md (A04) | accepted M1 phone scope; see closeout below |
| Attendant 3 · Offline sale and uploads | A27 A05 A08 A23 A14 | WO-app-2, WO-app-3, WO-app-8 | offline-capture-fidelity.md (A27/A05); upload-sync-fidelity.md (A08/A23/A14) | on-staging; price resolution remains later scope |
| Attendant 4 · Register a customer | A06 A25 A07 | WO-app-6 | | todo |
| Attendant 5 · History and own correction | A09 A10 A11 | WO-app-7 | | todo |
| Attendant 6 · Cooking gas sale | A15 A16 | WO-app-2, WO-app-3 | offline-capture-fidelity.md (A15); upload-sync-fidelity.md (A16) | accepted M1 phone scope; see closeout below |
| Attendant 7 · Pump reassignment | A17 | WO-app-5 | | todo |
| Attendant 8 · Offline access expired | A18 | WO-app-2 | offline-capture-fidelity.md; offline-capture.spec.ts | on-staging |
| Attendant 9 · Admin-assisted recovery | A19 A20 A21 A22 | WO-app-9 | | todo |
| Admin 1 · Sign in, first password, sign out | B01 B08 B09 B18 | WO-app-4 | tests/design-parity/admin-access/REPORT.md (32 sanitized screenshots; limitations below) | accepted WO-app-4 implemented states; M01/M02 fidelity follow-up WHR-70; H07 reference-only |
| Admin 2 · Password recovery | B10 B11 M02 B12 B13 | WO-app-4 | tests/design-parity/admin-access/REPORT.md (32 sanitized screenshots; limitations below) | accepted WO-app-4 implemented states; M01/M02 fidelity follow-up WHR-70; H07 reference-only |
| Admin 3 · Email verification | B14 M01 B15 B16 B17 | WO-app-4 | tests/design-parity/admin-access/REPORT.md (32 sanitized screenshots; limitations below) | accepted WO-app-4 implemented states; M01/M02 fidelity follow-up WHR-70; H07 reference-only |
| Admin 4 · Overview | B02 | WO-app-12, WO-spec-4 (spec only) |  | todo |
| Admin 5 · Sales and exception reviews | B03 B04 S01 S02 S03 S04 S06 S07 S09 | WO-app-7, WO-app-8 | | todo |
| Admin 6 · Customers and account changes | C01 B05 S08 C02 C03 C04 C05 | WO-app-6, WO-app-9 | | todo |
| Admin 7 · Loyalty cards | B06 K01 K04 K02 K05 K06 K03 | WO-app-6 | | todo |
| Admin 8 · Attendants and pump assignment | D01 D02 D04 D03 F04 F09 F10 | WO-app-5 | | todo |
| Admin 9 · Station pumps | F01 F02 F03 | WO-app-5 | | todo |
| Admin 10 · Product prices | F05 F06 F07 F08 | WO-app-5 | | todo |
| Admin 11 · Leaderboards and finalization | E01 E02 E04 E03 | WO-app-11, WO-spec-4 (spec only) |  | todo |
| Admin 12 · Reports | E05 E06 E07 | WO-app-12, WO-spec-4 (spec only) |  | todo |
| Admin 13 · Audit history | G01 G02 G03 G04 G05 | WO-app-10 | | todo |
| Admin 14 · Settings | B07 T01 T03 T02 T04 | WO-app-13, WO-spec-4 (spec only) |  | todo |
| Admin 15 · Admin users | H01 H02 H09 H03 H04 | WO-app-4 | tests/design-parity/admin-access/REPORT.md (32 sanitized screenshots; limitations below) | accepted WO-app-4 implemented states; M01/M02 fidelity follow-up WHR-70; H07 reference-only |
| Admin 16 · Roles and permissions | H05 H06 H10 H08 H07 | WO-app-4 | tests/design-parity/admin-access/REPORT.md (32 sanitized screenshots; limitations below) | accepted WO-app-4 implemented states; M01/M02 fidelity follow-up WHR-70; H07 reference-only |

D03-AttendantProfile's **Reset password** and **Disable account** buttons are placeholders, not scope, until a work order covers them.

## WO-app-1 design-system foundation (WHR-2)

The 16 UI wrappers and development-only gallery are verified by `tests/design-parity/design-system/gallery.spec.ts` and `tests/e2e/gallery-production.spec.ts`; see [fidelity report](../qa/design-system-fidelity.md) for all component comparisons and 19 captures. Gallery checks10/10 and production checks4/4 passed before review. Status: accepted by Earl on 4 November 2026; foundation PR #12 and wrap fix PR #20 are merged into staging. Acceptance is recorded from Earl’s explicit close instruction. These component checks do not establish built-screen parity for any complete board row or implement business invariants; those statuses above remain unchanged.

WO-app-1 wrap FIX (WHR-2): four actual-viewport line-box regressions cover AppHeader and LoyaltyCard at 390px/360px; see `docs/qa/design-system-wrap-fidelity.md`. Component fidelity only, with no completed screen or business invariant claim.

## WO-core-1b review-gate maintenance (WHR-41)

No product invariant or board row changed. `scripts/review/test-review.sh` covers an unrelated staging merge passing, a merge changing a PR file failing, and a later PR commit failing. Ancestor and unchanged-plan protections remain required. Gate maintenance is accepted by Earl on 4 November 2026 ("Accepted. lets close this session"), implemented on staging in PR #17 (746ede4), with independent code/security/integrity PASS and all five required CI checks green. EM Bash 3.2 review self-test: 39 passed, 0 failed; guard: 94 passed, 0 failed. WHR-44 is accepted by Earl; its guard self-tests remain operational coverage, not product coverage.

## WO-app-2 offline capture (WHR-5)

Client implementation reaches READY on the reviewed green staging merge of `app/wo-2-offline`. EM verification: typecheck, lint, 74 unit tests, production build, 32 Playwright tests, and three timezone tests in each of UTC and America/New_York. The rows above map its named tests; phone acceptance remains pending. The test transport follows M1; real sign-in/session endpoints remain WO-core-3. Uploads/credit remain WO-app-3/WO-core-4. These tests do not establish server authorization, registration or upload-first completion.

Required board subset: A01/A26/A12/A13, A02/A24/A03, A27/A05, A15 and A18. Independent parity report: `docs/qa/offline-capture-fidelity.md` (11 boards at 390 px and 360 px). Remaining boards in those shared rows retain their future work-order scope. Phone runbook: `docs/qa/smoke-2026-11-04-offline-capture.md`; Earl runs it only after WO-core-3 merges.

Local-only invariants I-23, I-24, I-49 and I-50 and board A18 are implemented and tested; their on-staging status takes effect with this work order’s reviewed green staging merge. Broader rows remain building where server sign-in, registration, upload-first or server validation is still owed by another work order. The shared board rows also remain incomplete for A04/A08/A23/A14/A16; the report covers only the eleven WHR-5 boards above. Physical camera readability, storage eviction and Android/TalkBack behavior await the deferred phone smoke.

## WO-core-15 deployment preparation (WHR-28)

This work prepares source configuration for Earl to provision temporary Cloudrock staging. It does not establish a running cloud environment or complete I-48 photo-storage implementation. The private-bucket instructions and runtime-only staging credentials support I-48; its invariant row stays todo until authorized uploads/reads are implemented and tested. No complete hi-fi board row changes status.

| Operational behavior | Named verification | Status |
|---|---|---|
| Runtime staging gate; production gallery stays closed with flag alone | `src/server/lib/environment.test.ts` | source verification; cloud pending |
| Health success and generic credential-free failure | `src/server/modules/health/service.test.ts` | source verification; cloud pending |
| Staging database certificate and hostname validation | `tests/unit/staging-entrypoint.test.ts` | source verification; cloud pending |
| No-op email discards sensitive content without delivery/logging | `src/server/adapters/email.test.ts` | source verification; cloud pending |
| Repeatable fictional deployment fixtures | `tests/integration/core-schema.test.ts` — fictional fixtures can be seeded twice without changing history | source verification; cloud pending |

Earl executes [the provisioning runbook](../ops/staging.md) and [phone smoke steps](../qa/smoke-2026-11-04-staging.md). Provider spec validation, deployed HTTPS health/gallery, private Spaces permissions and next-merge automatic redeployment remain pending.

Local verification: unit 27, integration 49, typecheck/lint/build and actual amd64 image checks passed. Migration and repeated seed succeeded; both clients rejected wrong hostname and untrusted CA. Staging HTTP health/gallery/banner/noindex and production gallery isolation passed. PR #22 is merged with all five required CI checks green, including full browser tests; local Chromium startup is sandbox-blocked. No cloud coverage is claimed.

## WO-core-3 accepted closeout (WHR-4), 5 November 2026

Earl accepted WO-core-3 in this session. PR #30 merged at 944b234 with all five CI checks green and independent code/security/integrity PASS. Backend verification recorded on WHR-4: unit 77, integration 65, time 3 per timezone, actual HTTP Playwright 1; full browser CI 36 passed with 4 conditional skips. Acceptance covers the server authentication slice described above; outstanding client and sync rows retain their existing scope. Closeout takes effect on this documentation merge. WHR-57 remains separate.

## WO-core-15 console-alignment FIX (WHR-28), 5 November 2026

The FIX aligns the managed `pg` cluster and private bucket with Rook's console report, and documents trusted ingress configuration and Earl-only credential provisioning. `tests/unit/staging-spec.test.ts` has three regression cases for console alignment, disabled trust/empty secrets, and CORS/live-update safety. Rook reported deployed health/noindex and automatic redeployment verified on 5 November; Earl's phone banner check and console configuration/data steps remain pending. No cloud operations were run in this session and I-48 remains incomplete. READY takes effect on reviewed green staging merge.

## WO-core-1d review-routing enforcement (WHR-53)

`bash scripts/review/test-review.sh` verifies contract and data-model files route high and unrelated engineering documentation preserves its prior tier. `bash .codex/hooks/test-guard.sh` guards the existing command protections. Operational status: READY on reviewed green staging merge; final self-test counts and merged PR are recorded on WHR-53. No product invariant or board status changes: this work closes the documentation review-routing gap raised in Rook's WHR-46 comment.

## Accepted operational closeout, 5 November 2026

Earl accepted WHR-28 FIX and WO-core-1d (WHR-53) explicitly. WHR-28 source/runbook FIX is accepted through merged PR #32; WHR-53 routing enforcement is accepted through merged PR #33 (review44/44, guard94/94, five CI checks green, independent code/security/integrity PASS). This records acceptance of those delivered slices, not new cloud operations, completed I-48, or full board parity. WHR-58 provider assurance remains separate. Work orders move to Done after this docs-only closeout merges.
## WO-core-4 sync and evidence (WHR-6)

Backend slice: M1 lookup, durable originals/receipt, scoped permissions, bounded JPEG validation, immutable final evidence and atomic accepted revision/audit. P-18 is implemented in `src/server/modules/sync/capture-policy.ts`. Policy blocks persist separately from holds and project M1 `policy_review_required`, as WO-spec-3a/M3 explicitly requires (WHR-59 resolved from existing text). No review/correction UI or policy resolution is implemented.

`tests/integration/sync-sales.test.ts` uses real PostgreSQL and actual presigned MinIO PUTs for lost-response replay, simultaneous finalize, staging overwrite after acceptance, account isolation/revocation,24h expiry, mixed P-18 conditions, invalid evidence and storage/lookup failure. `storage.test.ts` checks HTTPS Spaces virtual-host signing and fixed JPEG headers. Automated local behavior is distinct from Earl's actual deployed Spaces smoke. No complete additional board parity or Android acceptance is claimed. See `docs/qa/smoke-2026-11-05-core-sync.md` and the pasted verification on WHR-6. On-staging statuses take effect only after reviewed green merge.

WO-core-4 review regressions: exact PostgreSQL microsecond price/campaign/assignment boundaries remain zero-credit, finalized IDs can repeat across separate purchases, captured-rate mismatches are bounded422 errors, and presigned PUTs enforce exact original byte length at storage. `tests/storage/signed-upload.spec.ts` verifies actual browser Blob length/CORS compatibility and storage rejection of wrong length; no signed-URL artifacts are recorded.

## WO-core-4 accepted closeout, 5 November 2026

Earl accepted WHR-6 explicitly. PR #36 merged at 2404344 with green CI and independent code/security/integrity PASS. Its backend coverage and named verification above are accepted; no additional board parity or physical-phone coverage is claimed. P-20 is a separate follow-up in WHR-62, dependent on WHR-61, and M3 capture review remains WO-core-9.

## WO-core-4a capped capture policy (WHR-62)

P-20 evaluates price, assignment/revocation and campaign history over the closed interval [S, min(R, original offlineExpiresAt)] using exact microseconds. Actual first receipt still decides the upload deadline. New settlements store policy version 2; existing held version-1 results remain unchanged. No migration or backfill is included. Implementation reaches READY on the reviewed green staging merge; final EM output and PR are recorded on WHR-62.

| Behavior | Named verification | Scope |
|---|---|---|
| Late delivery with fresh same-account upload authority; in-window price/assignment holds | `sync-sales.test.ts`: P-20 Monday 07:00 capture with Tuesday 09:05 receipt and fresh upload authority | I-03, I-05a, I-26, I-28, I-31 |
| Closed interval and exact PostgreSQL microseconds | `sync-sales.test.ts`: P-20 PostgreSQL price boundary at original expiry microseconds; `capture-policy.test.ts`: P-20 capped capture interval | I-05a, I-31, I-45a |
| Existing held result preserved through retry and reauthentication | `sync-sales.test.ts`: P-20 existing v1 expiry-only hold survives retry and reauthentication unchanged | I-22, I-26, I-28 |
| Campaign purchase bounds use U; upload deadline uses R; invalid bounds fail closed | `capture-policy.test.ts`: P-20 capped capture interval | I-45a |

M3 capture review remains WO-core-9. Q-528 client confirmation, physical-phone acceptance and deployed Spaces smoke remain distinct; no additional board parity is claimed.

## WO-app-3 upload client READY (WHR-7)

[PR #35](https://github.com/Adeboyemoses/Whalesreward/pull/35) merged at f969d95 with all five CI checks green. The client delivers typed M1 submit → signed upload → immutable finalize → authoritative status, retry/backoff and leases, pending upload counts, fuel/gas receipts, mixed holds and cancellable upload-first logout. Only validated server credit produces Synced. Original sales and photo blobs remain available after failure. No history, correction, deletion or cloud work is included.

EM final combined-base checks: typecheck, lint, 135 unit tests and production build pass. Integration and browser CI passed; local timing failures and unchanged targeted reruns remain disclosed in the feature evidence/runbook. [upload-sync-fidelity.md](../qa/upload-sync-fidelity.md) independently covers A04/A08/A23/A14/A16 at 390/360 px with ten screenshots and no new blocking difference. A13 upload-first behavior has browser coverage; no additional A13 visual parity is claimed here.

| Client responsibility | Named evidence | Delivered scope |
|---|---|---|
| Replay, lost responses, immutable finalize, leases and retry | sync.test.ts, sync-api.test.ts, upload-sync.spec.ts | I-22/I-25/I-28 client behavior |
| Authoritative credit/cancellation and independent mixed holds | sale-presentation.test.ts, upload-sync.spec.ts | I-26/I-27/I-31/I-33/I-34/I-35 display; admin resolution remains later scope |
| Handover, upload-first cancellation and expiry | sync.test.ts, upload-sync.spec.ts | I-03/I-06 client boundaries |
| Retained original/evidence and generic-only cache | offline-capture.spec.ts, sync.test.ts, sync-api.test.ts | I-23/I-48/I-49/I-50 client boundaries |

READY is not acceptance. [Phone runbook](../qa/smoke-2026-11-05-upload-sync.md): staging HTTPS with actual private Spaces is primary, adb reverse fallback. Earl must manually cover partial photo failure and expired upload permission. WHR-60 was subsequently diagnosed and stabilized by WO-app-3a (see below); WHR-45 presentation drift remains separate. WO-core-4 endpoints are delivered, but this client fixture suite does not prove deployed storage or physical Android behavior. WHR-5 stays READY pending Earl's phone smoke. Stop; no next app work order.

## WO-core-4a accepted closeout (WHR-62), 5 November 2026

Earl accepted P-20 implementation in PR #39 (a1e674c). The named capped-interval, microsecond and unchanged-held-replay tests above are accepted: unit108, integration104, browser36 with4 existing conditional skips, time3 per timezone, and all five CI checks passed. No new product coverage or board parity is claimed by this records-only closeout.

## WO-app-3a upload-failure browser verification READY (WHR-60)

[PR #45](https://github.com/Adeboyemoses/Whalesreward/pull/45) merged at e7999cc. This test-only follow-up stabilizes the existing I-25 evidence/permission checks while preserving I-22/I-26 original-sale and credit assertions. No board or production behavior changed.

| Existing browser test in upload-sync.spec.ts | Verification |
|---|---|
| I-25 partial photo failure retains evidence and retry uses the original sale | Durable photo failure and lease release before navigation; 20 consecutive passes on each profile |
| I-25 expired storage PUT permission preserves the signed-in account and resumes safely | Same original account/operation synchronization; 20 consecutive passes on each profile |

Local Linux: 80/80 repeats, two workers, zero failures/skips/retries. EM full browser: 68 passed, four existing staging-only skips, zero retries; unit135, typecheck/lint/build PASS. Independent code/security/integrity PASS in round1. [CI pass1](https://github.com/Adeboyemoses/Whalesreward/actions/runs/42054766711/attempts/1) and [CI pass2](https://github.com/Adeboyemoses/Whalesreward/actions/runs/42054766711/attempts/2) each passed68 browser cases plus storage1 without flaky cases. [Diagnosis](../qa/upload-failure-browser-diagnosis.md) records the baseline9pass/3fail and natural60-second lease recovery on both profiles. On-staging, READY; physical-phone and deployed Spaces acceptance remain pending. No new invariant implementation or screen parity claimed.

## WO-core-1e feature/records separation (WHR-63)

Operational coverage only: PR #43 merged at e8b7550 with three independent reviewers passing round2 and all five CI checks green. `scripts/review/test-review.sh` verifies protected STATUS/coverage/lane edits, removal and rename fail with feature evidence; docs-only records and unrelated staging record changes pass; README-only incomplete evidence retains the existing exemption while adding STATUS fails. EM review53/53 and guard94/94 passed, along with typecheck/lint/unit135/build. No product invariant or board status changes. READY records #44 merged at 4b88f93. Earl accepted WHR-63 on 5 November 2026; operational status is accepted and closure takes effect on this separate green records merge. No product coverage changes.

## WO-core-5 admin access and recovery READY (WHR-8)

Feature [PR #50](https://github.com/Adeboyemoses/Whalesreward/pull/50) merged at e153287 with all five CI checks green. Code/security/integrity PASS round 2 at 5397551; evidence `.review/core__wo-5-admin-access.md`. EM final typecheck/lint/build PASS, unit140/23files, real PostgreSQL/MinIO integration129/7files including25 named admin adversarial tests. Local Linux browser68 passed, four existing staging-only skips, zero retries; native Chromium startup was sandbox-blocked.

Additional named regressions in `admin-access-adversarial.test.ts`: `I-07/I-10 authorized role lists paginate and assignable roles exclude excess authority`; `I-12 bounded mail job continues after unknown and unverified requests to a valid reset`; `I-12 bounded mail job continues after superseding an obsolete delivery intent`; `I-12 bounded mail job continues across the 100-account lookup page`. All four failed before the round-1 fixes and passed afterward. Token inspection, concurrent consumption, uncertain delivery, credential receipt key rotation and historical replay are also covered. Full named output is pasted on WHR-8 at READY.

B01/B08–B18, M01/M02 and H01–H10 have backend support only. Admin board rows remain `todo` for WO-app-4 screen implementation/parity; no UI acceptance claimed. WHR-42/43 defaults remain proposed and centrally configured; production auth/delegation closed, staging no-op mail, automatic presets disabled. No live provider or cloud/staging-data operations. This separate records PR follows the feature merge; stop at READY after its green merge. WHR-63 is ACCEPTED/Done through #48 (82dfe65).

WO-core-5 (WHR-8) accepted by Earl on 5 November 2026. Feature #50 and READY records #51 are merged; the closeout records acceptance of the existing I-07–I-13 and I-41 tests above, with no new implementation or board parity claim.

## WO-core-5a staging transactional email READY (WHR-66)

Feature [#55](https://github.com/Adeboyemoses/Whalesreward/pull/55) is merged with all five CI checks green and code/security/integrity PASS round 2 at a9c8efd. This separate records PR adds implementation coverage for I-12, I-13 and I-41; no screen parity or real inbox delivery is claimed. T-15 records provider selection in #54. WHR-8 is accepted and Done through #53.

- `zoho-mail-adversarial.test.ts`: `I-12 approved staging verification, reset and security notice use the configured provider without verifying on send` also asserts secret-free I-41 audit; `I-12 refused staging recipient makes no request, revokes its challenge and needs a fresh verification request`; `I-12 uncertain provider failure revokes the exposed link and never retries it`; `I-12 public recovery remains generic for refused, unverified and unknown staging addresses`.
- `staging-email-seed.test.ts`: `I-12 sets the staging inbox only on initial insert and never verifies it`; `I-12 reruns preserve existing email, verification and version`; `refuses non-staging or malformed email without echoing values`; `rejects a duplicate inbox instead of silently creating an unusable admin`. Existing I-13 first-password/insert-only credential tests continue passing.
- `email.test.ts` and `email-config.test.ts` exercise local HTTP contract, exact recipient rejection, staging markings, provider error/timeout/oversize handling, redirect refusal, safe logging and production configuration refusal. `instrumentation.test.ts` and `staging-email-startup.spec.ts` prove invalid production allowlists exit with code 1, including empty and populated values, without private output.

EM final gates: typecheck/lint/build PASS; unit 185/28 files; real PostgreSQL/MinIO 137/9 files; exact-source Linux browser 98 passed, four existing staging-only skips and no retries. Non-root amd64 image builds, includes the bounded worker, runs it against a local DB with no-op delivery and exits 1 on invalid production mail config. One unchanged sync test timed out under competing image/browser load; focused and complete isolated reruns passed without code/timeout changes. Actual provider delivery and recipient confirmation remain Earl's acceptance step in `docs/ops/staging.md`.

## WO-app-3b phone-smoke ACCEPTED (WHR-65)

[PR #49](https://github.com/Adeboyemoses/Whalesreward/pull/49) merged and deployed at `d3481fc6e39dabe8ab5e087ee581b91d891f56ed`; health matched with db ok. Code/security/integrity PASS round2. These scoped regressions preserve the original strict rules; they do not mark broader board rows complete.

| Invariant / boards | Evidence | Status |
|---|---|---|
| I-03, I-09: original 24-hour boundary and revocation | `tests/e2e/phone-smoke.spec.ts`: delayed revocation, exact expiry despite late success; `src/client/offline/client.test.ts`: late auth/permission/assignment denial retains original/photo and sticky lock | on-staging; accepted WHR-65 scope |
| I-06: account/context partition | `phone-smoke.spec.ts`: stale cross-account session response; retained upload/handover suite | on-staging; accepted WHR-65 scope |
| I-23: durable atomic capture independent of network | `phone-smoke.spec.ts`: held repeated lookup, stalled RSC, pending upload, two-second Save/next on 3G/offline; original/photo retained | on-staging; accepted WHR-65 scope |
| I-29: exact money and quantity | `phone-smoke.spec.ts`: PMS/gas blur/refocus and exact2000001kobo original; unchanged quantity semantics | on-staging; accepted WHR-65 scope |
| I-26: authoritative credit/reference | `phone-smoke.spec.ts`: pending, assigned and credited PMS/gas references; no false Synced or local credit | on-staging; accepted WHR-65 scope |
| I-49: generic-only shell cache | `phone-smoke.spec.ts`: actual service-worker stalled headers/body fallback;1200ms deadline; no API/personal cache | on-staging; accepted WHR-65 scope |
| I-02, I-04, I-50: preserved capture/context/evidence boundaries | `phone-smoke.spec.ts`: original account/context/card/spend/photo digest retained after delayed lookup and next sale; existing offline/upload suites retained | on-staging; regression coverage |
| A02, A03, A04, A05, A08, A16 | `tests/design-parity/phone-smoke/REPORT.md`: independent six-board comparison,12 screenshots at390/360px;48px targets/no overflow | scoped fidelity verified; existing WHR-45 differences separate |

Final EM typecheck/lint/build and unit164 passed; browser94 passed/4 existing skips/zero retries. [Final CI](https://github.com/Adeboyemoses/Whalesreward/actions/runs/42094998766): integration129, time3+3, browser94/4 existing skips/no flaky cases, storage1. [Baseline](../qa/phone-stall-baseline.md) measured real staging before edits: Save4145.2ms, next2021.9ms; the reported1–3minute wait was not reproduced. No deployed after-timings claimed. Earl/Rook superseded desktop after-timing work; no further Computer Use. Rook's20:36UTC WHR-65 comment reports Earl's successful Samsung rerun without saved numeric timings. Earl subsequently explicitly authorized closing WHR-65, WHR-7 and WHR-5. [Runbook](../qa/smoke-2026-11-05-phone-stall.md). WHR-67 remains separate.

## M1 app acceptance closeout (WHR-5, WHR-7, WHR-65)

Earl accepted the Samsung rerun and explicitly instructed closure of all three work orders on5November2026. [Closeout PR #52](https://github.com/Adeboyemoses/Whalesreward/pull/52) follows merged feature PRs#28/#35/#49; Linear Done follows its reviewed green staging merge. M1 phone exit is accepted. This supersedes historical READY/pending-phone notes for these work orders; test/parity reports retain their original measurement scope. No new implementation, numeric after-timing or broader future board coverage is claimed.

- WO-app-2 accepted scope: I-02/I-03/I-06/I-23/I-24/I-29/I-30/I-49/I-50 client capture boundaries; `offline-capture.spec.ts`, `client.test.ts`, `window.test.ts`;11-board `docs/qa/offline-capture-fidelity.md` (A01/A26/A12/A13/A02/A24/A03/A27/A05/A15/A18).
- WO-app-3 accepted scope: I-06/I-22/I-23/I-26/I-27 and retained I-48/I-49/I-50 boundaries; `upload-sync.spec.ts`, `sync.test.ts`, `sync-api.test.ts`; five-board `docs/qa/upload-sync-fidelity.md` (A04/A08/A23/A16/A14 held state). Later review-resolution/history/correction scope remains deferred.
- WO-app-3b accepted scope: the invariant and six-board regressions above; final combined evidence in `docs/qa/phone-smoke-regressions.md`. Original24-hour/revocation rules unchanged. WHR-45 and WHR-67 remain separate; WHR-60 is not closed by this record.

WO-core-5a (WHR-66) accepted by Earl on 6 November 2026. Feature #55 (9fc4a75), decision #54 (d53a468), and READY records #56 (6f1152d) are merged; this closeout accepts the existing I-12/I-13/I-41 coverage without claiming real inbox delivery. Automatic sending is the separately authorized WHR-68 scope.

## WO-app-4 admin access READY (WHR-9)

Feature [PR #60](https://github.com/Adeboyemoses/Whalesreward/pull/60), followed by this separate records merge, delivers the M2 admin client. Independent code/security/integrity PASS round 2 at 66980288; evidence `.review/app__wo-4-admin-access.md`. EM typecheck/lint/build PASS,189 unit tests, exact-source Linux browser 100passed/four existing staging-only skips / zero retries; dedicated real PostgreSQL/Mailpit 4passed/zero failures or skips (27.8 s). Browser execution is local Linux because native Chromium is sandbox-blocked. No deployed inbox or physical-device acceptance claimed.

| Invariants | Named test evidence | Scope |
|---|---|---|
| I-07/I-09/I-13 | default e2e `I-07 I-09 I-13 admin browser restriction, role dependency, confirmed access and revoked session` | Real API restricted first password, review-before-write, dependencies and revocation |
| I-07/I-09/I-12/I-13 | dedicated `I-07 I-09 I-12 I-13 named admin first-password, users, verification, recovery and revocation on real Postgres and Mailpit` | Recipient confirmation, consumed/replaced/same-tab links, scrubbed Back/Forward, reset revocation; frozen role grants/count |
| I-07/I-08/I-10 | dedicated `I-07 I-08 I-10 server refusals survive user confirmation: last Owner, stale version and delegation` | API refusals shown in plain words; server remains authoritative |
| I-13 | dedicated `I-13 restricted first-password session can sign out without entering portal` | Restricted logout regression |
| I-11 | default and dedicated role dependency assertions; existing canonical server catalogue tests retained | 28 grouped actions, protected Owner, independent sensitive grants; no client authorization bypass |
| I-41/I-49 | existing core audit and generic-only service-worker tests retained; `admin-api.test.ts` no-store/safe errors | Preservation boundaries; no server audit or cache-policy changes |

[Independent report](../../tests/design-parity/admin-access/REPORT.md) accounts for all 24 requested boards and 32 sanitized captures at 1440 px / 390 px, including real delivered M01/M02 HTML clones with all live token text/hrefs redacted. It verifies implemented hierarchy/states/controls, not exact pixel equality. H07 is a permission-reference input, with Reports API/data outside scope. M01/M02 are existing core templates with explicit nonblocking differences tracked in WHR-70; user/role record/history/picker details in WHR-69. These partial/reference states must not be read as full report or email-template parity.

READY stops here. Earl follows [the first-written staging runbook](../qa/smoke-2026-11-06-admin-access.md), creating a second fictional admin through the normal UI with an exact-allowlisted private test inbox. No seed repair, cloud change or manual verification occurred. No acceptance or work-order Done claim is made.


## WO-core-5b automatic admin mail READY (WHR-68)

Feature [#59](https://github.com/Adeboyemoses/Whalesreward/pull/59) and T-16 [#58](https://github.com/Adeboyemoses/Whalesreward/pull/58) are merged with all five checks green. Code/security/integrity PASS round 1 at 1b10c1f. These separate records cover I-12/I-41/I-52 for admin mail only; retention, orphan and backup scheduling remains WO-core-16. No new screen parity or real inbox delivery is claimed.

Named independent PostgreSQL tests in `tests/integration/admin-mail-loop-adversarial.test.ts`:

- `I-12/I-52 two live polling instances claim a queued verification once`.
- `I-12/I-52 redeploy revokes an expired in-flight lease without replay and fences a late acknowledgement`.
- `I-12 failed automatic delivery stays failed across replacement polling loops`.
- `I-52 one recovery step retires at most twenty-five abandoned sends without reconstructing their links`.
- `I-52 shutdown drains the claimed send but leaves later work for a replacement instance`.
- `I-52 an empty outbox waits between polls and newly queued work sends within sixty seconds with counts-only reports` (I-41 privacy assertion).

`mail-loop.test.ts` checks empty cadence, count-only batch limits, no overlap, active-attempt drain, private failure suppression and the claim-time budget. `mail-runtime.test.ts` checks unset/no-op-provider/build inactivity, process-global singleton and preserved native shutdown. `automatic-mail-lifecycle.spec.ts`: `compiled web runtime automatically sends, keeps health responsive and drains real SIGTERM` passes in both browser projects, including secret-free output.

EM verification: typecheck/lint/build PASS; 197 unit tests, 143 PostgreSQL/MinIO integration tests, Linux browser 102 passed/four existing staging-only skips. The amd64 container builds, returns health/database OK, exits 143 on SIGTERM and the packaged no-op worker exits without a database. Two feature browser CI setup attempts stalled on Ubuntu font downloads before tests; fresh-runner retries passed. WHR-71 tracks the separate infrastructure follow-up. An inherited admin-test redirect race is tracked as WHR-72; the final unchanged full rerun passed. Earl's deployed inbox smoke remains pending using the WO-app-4 UI under docs/ops/staging.md steps 5–6; no manual mail command. No cloud, provider or staging-data operations.

## WO-core-5c Zoho acceptance and safe diagnostics READY (WHR-73)

Feature [#64](https://github.com/Adeboyemoses/Whalesreward/pull/64) and T-17 [#63](https://github.com/Adeboyemoses/Whalesreward/pull/63) merged with all five CI checks green. Code/security/integrity PASS round 1 at e506d8f. T-17 supersedes T-15 using Earl's direct API evidence; T-14 auth and T-16 polling remain unchanged. This adds I-12/I-41/I-52 admin-mail regression coverage only; no new screen parity, production activation or real inbox delivery is claimed.

Named tests in `tests/integration/zoho-diagnostics-adversarial.test.ts`:

- `I-12/I-52 us HTTP 201 with EM_104 sends once across competing workers and preserves the unconfirmed link`, plus EU/200 control.
- `I-12/I-41 a rejected HTTP status records only its safe provider code, revokes the link and never replays`.
- `I-12/I-41 HTTP 201 with a provider error does not accept or leak the failed link`.
- `I-12/I-41 HTTP 201 without a valid acknowledgement revokes the link with response_invalid`.
- `I-12/I-41 a successful-looking acknowledgement on HTTP 202 remains a single failed attempt`.
- `I-41 a provider error code with an appended private payload is omitted from failure diagnostics`.
- `I-12/I-41 explicit prefixed-token configuration is refused before transport and revokes the queued challenge`.

`email-diagnostics.test.ts` covers all six reasons, safe setting names, exact provider-code validation, canary privacy, byte/time bounds, acknowledgement precedence and `accepts US HTTP 201 with EM_104 and no warning`. Runtime/instrumentation tests cover once-per-process started/disabled events and production/build/unset/no-op gates. `staging-email-startup.spec.ts`: `compiled staging server rejects a prefixed token with only safe diagnostics`; existing compiled production refusal and real SIGTERM coverage also pass.

Red-to-green: builder diagnostics 26 failures/four controls; independent PostgreSQL seven failures/one control; acknowledgement-precedence regression two failures before correction. EM final verification: typecheck/lint/build PASS, unit 245, PostgreSQL/MinIO 151, Linux browser 104 passed/four existing staging-only skips. First feature browser CI setup was cancelled during slow Ubuntu font downloads before tests; fresh-runner attempt passed (WHR-71). One earlier builder integration run failed an inherited I-03 boundary test; unchanged builder and EM reruns passed. WHR-74 tracks investigation separately; no sync-rule or retry changes. Earl's deployed verification email and safe email.* logs remain pending under docs/ops/staging.md steps 5–6. No cloud/provider or staging-data operations.

## WO-core-5b/5c staging email accepted (WHR-68 / WHR-73)

Earl accepted both work orders on 6 November 2026 and explicitly instructed their closure. The [WHR-9 acceptance record](https://linear.app/phaneum/issue/WHR-9/wo-app-4-admin-access-screens#comment-7628467b-c011-4f8e-ba03-f89caca7cdfc) reports the successful admin smoke rerun, including real verification and reset email through Zoho CPaaS US, with no failed or blocked steps remaining. This supersedes the earlier pending deployed-email notes for WO-core-5b/5c. Both become Done after this reviewed closeout merges; WHR-9 closure remains with lane:app.

The existing I-12/I-41/I-52 automated coverage above is accepted for admin email: `admin-mail-loop-adversarial.test.ts` competing claims, recovery and shutdown; `zoho-diagnostics-adversarial.test.ts` US/201 acceptance, single attempts, failed-link revocation and safe diagnostics; `email-diagnostics.test.ts` reason-code/privacy bounds; compiled startup and lifecycle tests. Feature #59, decision #58, READY records #62, feature #64, decision #63 and READY records #65 are merged. Latest feature EM evidence remains unit 245, PostgreSQL/MinIO 151 and browser 104/four existing staging-only skips, plus typecheck/lint/build PASS. No new implementation, test cases or board-parity claim is added by this records-only closure. Other scheduled jobs and audit domains remain pending.

Production activation remains gated by WHR-42; WHR-71/72/74 remain separate follow-ups. No cloud/provider or staging-data operations were performed by this session, and no private email configuration is recorded here.

## WO-app-4 admin access ACCEPTED (WHR-9)

Earl explicitly accepted the staging smoke and instructed closure on 6 November 2026. [WHR-9 acceptance evidence](https://linear.app/phaneum/issue/WHR-9/wo-app-4-admin-access-screens) records Admin Access Test rerun `r-20261106-115321` with no failed or blocked steps. It confirms real verification and reset mail through Zoho CPaaS US, recipient verification, and the corrected last-Owner/delegation scenarios. The last-Owner check uses the sole active Owner; delegation is checked using a non-Owner without the target grants. The earlier failed checks were runbook ambiguities, not permission-enforcement defects. No mailbox addresses, credentials, email bodies or token values are copied here.

Feature [#60](https://github.com/Adeboyemoses/Whalesreward/pull/60) and READY records [#61](https://github.com/Adeboyemoses/Whalesreward/pull/61) remain the implementation evidence. This separate closeout records acceptance of the existing I-07–I-13 client flows and I-41/I-49 preservation boundaries, named tests and board comparisons above. It supersedes WO-app-4's earlier READY/pending-smoke status; it adds no code, test results, policy, cloud action or broader invariant implementation.

[Independent board report](../../tests/design-parity/admin-access/REPORT.md) retains its original structural/state comparison and 32 sanitized screenshots. H07 remains permission reference only, with actual Reports outside scope. WHR-69 app record/pagination details and WHR-70 inherited email-template fidelity remain separate nonblocking follow-ups. Acceptance does not claim exact pixel parity or close those issues. WHR-68/73 are lane:core work orders and are not closed by this change.

WHR-9 moves to Done only after this reviewed closeout PR merges into staging with green CI. Stop after closure; no next work order is started.

## WO-core-6 M2 backend READY (WHR-10)

Feature [#68](https://github.com/Adeboyemoses/Whalesreward/pull/68) merged into staging
at c6390ec with all five required CI checks green. Code/security/integrity PASS round2
at3995e55; evidence `.review/core__wo-6-station.md` validates. This separate records
change adds no implementation or board parity. [Named output](../qa/verification-2026-11-06-station.md)
records EM unit248, PostgreSQL178, 27 station regressions, time3 per timezone,
production build/typecheck/lint, Linux browser104/four existing staging-only skips and
signed-upload1 PASS; no retries or policy relaxation.

| Scope | Named evidence | Status |
|---|---|---|
| I-01/I-04 personal provisioning and first password | `station-management.test.ts`: first password sessions cannot capture; bounded multibyte and three control-character credential roundtrips. `station-adversarial.test.ts`: cross-kind username collision, no partial provisioning, restricted no-context/config/sync denial | backend on-staging; UI WHR-77 pending |
| I-05/I-05a configured versus acknowledged assignment | `station-management.test.ts`: concurrent reassignments, fresh sign-in and four P-20 price/assignment inside=true/false cases. `station-adversarial.test.ts`: configured-assignment reads never acknowledge or rewrite context | backend on-staging |
| I-07/I-09/I-41 live authority and durable audit | `station-adversarial.test.ts`: OR-grant separation, revoked grant while waiting for security lock, replay reauthorization, strict/no-store inputs and cursor binding. `station-management.test.ts`: disabled account and transactional audit assertions | backend on-staging; no new disable endpoint |
| I-29/I-31/I-32/I-45a immutable immediate product configuration | `station-management.test.ts`: price CAS race, precision-only/no-change/overflow/stale confirmations, captured history retained | backend on-staging |
| I-26/I-28/I-31/I-32/I-45a uncommitted activation visibility | `station-price-visibility.test.ts`: in-interval rate change, precision-only change and rate change outside original capped interval wait for activation commit then credit only uniform history; original receipt unchanged | backend on-staging; RED before shared/exclusive lock fix, GREEN after |
| Bounded search pagination | `station-management.test.ts`: valid maximum-length search pagination roundtrips within cursor bounds (120 Chinese characters and 120 backslashes) | backend on-staging |

WHR-76 records broader pump edit/status and attendant status wording excluded by M2
and settled notes; no scope extension is inferred. WHR-77 is a high-priority app
first-password dependency; current screens parse only ready sessions. WO-app-5 owns
later price/assignment screen smoke. WHR-78 tracks one reviewer fixture-extension
setup collision; unchanged EM parallel178/27 and other reviewer27 runs passed.
Backend READY is not full work-order acceptance, UI parity or client Q-528 approval.
No cloud/provider or manual staging-data operation. Feature #68 used9 dispatches,
above the8 flag; two review rounds stayed within cap3. WHR-73/68 were already Done
through accepted closeout #66; this session confirms those records without new tests.
