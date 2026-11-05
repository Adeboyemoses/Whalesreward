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
| I-01 | Each attendant has a personal account: name, unique username, password and a permanent sys… | WO-core-3 (server) | attendant-auth.test.ts: personal credentials/context; attendant-auth.spec.ts: real sign-in | verified; READY on green staging merge |
| I-02 | Sign-in, account switching and customer registration need connectivity | WO-app-2 (client); WO-core-3 (server) | tests/e2e/offline-capture.spec.ts (handover; client scope); see authentication coverage below | building |
| I-03 | Offline capture is allowed for 24 hours after the last successful online sign-in | WO-app-2 (client); WO-core-3 (server); WO-core-4 (server); WO-spec-3b (spec only); WO-core-4a | src/client/offline/window.test.ts; offline-capture.spec.ts (24h, rollback, restart); see authentication coverage below; sync-sales.test.ts: exact24h write/read boundary; P-20 capped capture interval (capture-policy.test.ts); Monday outage, expiry microseconds and unchanged v1 hold replay (sync-sales.test.ts) | building |
| I-04 | An account writes only for its authorized station and pump | WO-core-3 (server) | see authentication coverage below | todo |
| I-05 | Pump reassignment is done by an authorized admin | WO-core-3 (server) | see authentication coverage below | todo |
| I-05a | A queued record from before a reassignment is validated against that account's assignment … | WO-core-4; WO-core-3; WO-spec-3b (spec only); WO-core-4a | sync-sales.test.ts: P-18 reauthentication; simultaneous assignment/price/campaign conditions; P-20 capped capture interval (capture-policy.test.ts); Monday outage, expiry microseconds and unchanged v1 hold replay (sync-sales.test.ts) | on-staging (server slice; effective on reviewed green merge) |
| I-06 | Logout offers upload-first when connected | WO-app-2 (client); WO-core-3 (server); WO-core-4 (server) | offline-capture.spec.ts (handover, cross-tab); client.test.ts (failed revocation); see authentication coverage below; sync-sales.test.ts: foreign account read/upload/finalize isolation | building |
| I-07 | Admin users, roles and permissions are separate from attendant accounts | WO-spec-4 (spec only); WO-spec-3b (spec only) | Not implemented; P-20 downstream checks above, not implemented | todo |
| I-08 | At least one active Owner always exists | | | todo |
| I-09 | Disabling an account or removing a permission revokes it on active sessions | WO-app-2 (client); WO-spec-4 (spec only); WO-core-3 (server); WO-core-4 (server); WO-spec-3b (spec only) | offline-capture.spec.ts (online session revocation); see authentication coverage below; sync-sales.test.ts: revocation during slow storage; P-20 downstream checks above, not implemented | building |
| I-10 | A role administrator cannot grant more authority than they hold | | | todo |
| I-11 | Five sensitive permissions default to Owner only and are granted separately: `queueRecover… | WO-spec-4 (spec only); WO-spec-3b (spec only) | Not implemented; P-20 downstream checks above, not implemented | todo |
| I-12 | Admin password recovery uses a verified email only | | | todo |
| I-13 | New admin accounts start with a temporary password and must change it at first sign-in | | | todo |
| I-14 | Registration captures name, phone and a fixed category: car owners, commercial bus drivers… | WO-spec-4 (spec only) | Not implemented | todo |
| I-15 | Phone numbers are normalized before the uniqueness check | | | todo |
| I-16 | Card codes are unique across all batches, collision-retried, reserved before print export … | | | todo |
| I-17 | QR scan and typed code resolve the same card | WO-core-4 (server); WO-app-2 (client) | sync-sales.test.ts: I-17/I-50 code and QR lookup; offline-capture.spec.ts (QR/typed) | on-staging (effective on reviewed green merge) |
| I-18 | Batch lifecycle is Generated → Printed → Active, forward only, server-validated, audited w… | | | todo |
| I-19 | A card can be linked only when its batch is Active and the card is unassigned and not reti… | | | todo |
| I-20 | PDF print sheets and Excel registers are generated from the reserved codes | | | todo |
| I-21 | Card replacement keeps the customer and retires the old card atomically | | | todo |
| I-21a | Before replacing a lost card, the admin verifies a code sent to the registered phone (thro… | | | todo |
| I-22 | Every sale has a client-generated operation ID | WO-core-4; WO-spec-3b (spec only); WO-core-4a | sync-sales.test.ts: lost-response retry; changed original content; concurrent finalize; changed finalize body; P-20 capped capture interval (capture-policy.test.ts); Monday outage, expiry microseconds and unchanged v1 hold replay (sync-sales.test.ts) | on-staging (effective on reviewed green merge) |
| I-23 | The sale and its photo blob are saved atomically in IndexedDB before the phone shows "Save… | WO-app-2 (client) | offline-capture.spec.ts (offline restart, quota); client.test.ts (atomic save) | on-staging |
| I-24 | Photos come from the live in-app camera only | WO-app-2 (client) | offline-capture.spec.ts (denied camera); client.test.ts (photo digest) | on-staging |
| I-25 | Uploads go to a unique staging path through a short-lived signed permission scoped to that… | WO-core-4 | sync-sales.test.ts: adversarial evidence; invalid/oversized decode; expired permission; real MinIO CORS; storage.test.ts | on-staging (server; deployed Spaces smoke pending) |
| I-26 | Credit needs: resolved customer, complete details, validated photo, price checks and eligi… | WO-core-4; WO-spec-3b (spec only); WO-core-4a | sync-sales.test.ts: concurrent finalize; revoked during storage; failed final-object write; P-18 mixed conditions; P-20 capped capture interval (capture-policy.test.ts); Monday outage, expiry microseconds and unchanged v1 hold replay (sync-sales.test.ts) | on-staging (effective on reviewed green merge) |
| I-27 | A definitive "customer not found" cancels the record with a reason | WO-core-4 | sync-sales.test.ts: definitive unknown card; transient lookup failure | on-staging (effective on reviewed green merge) |
| I-28 | Store app capture time and server receipt time separately | WO-core-4; WO-spec-3b (spec only); WO-core-4a | sync-sales.test.ts: lost-response retry; reauthentication; transient lookup preserves first receipt; P-20 capped capture interval (capture-policy.test.ts); Monday outage, expiry microseconds and unchanged v1 hold replay (sync-sales.test.ts) | on-staging (effective on reviewed green merge) |
| I-29 | Amount entry is the default; Quantity entry is available | WO-app-2 (client); WO-spec-4 (spec only) | client.test.ts (exact money); offline-capture.spec.ts (gas quantity) | building |
| I-30 | Liquids offer Bought into: Vehicle, Keg, Three-wheeler, Bike | WO-app-2 (client) | client.test.ts and offline-capture.spec.ts (gas cylinder) | building |
| I-31 | A sale is held for price review, with zero credit, only when its captured rate is an unres… | WO-core-4; WO-spec-3b (spec only); WO-core-4a | sync-sales.test.ts: uniform history/precision-only changes; price boundary holds zero credit through retry; P-20 capped capture interval (capture-policy.test.ts); Monday outage, expiry microseconds and unchanged v1 hold replay (sync-sales.test.ts) | on-staging (price hold; resolution remains later scope) |
| I-32 | Price activation is immediate on server confirmation, one price per product for the statio… | WO-spec-4 (spec only) | Not implemented | todo |
| I-33 | A sale uploaded against a card replaced before upload is held for card-eligibility review … | | | todo |
| I-34 | A sale with an unreliable capture date is held until an admin records an evidence-supporte… | WO-spec-3a (spec only); WO-spec-4 (spec only); WO-spec-3b (spec only) | Not implemented; P-20 downstream checks above, not implemented | todo |
| I-35 | Each hold (price, card, date) clears only itself | WO-spec-3a (spec only); WO-spec-4 (spec only); WO-spec-3b (spec only) | Not implemented; P-20 downstream checks above, not implemented | todo |
| I-36 | Admin-assisted recovery of a stranded queue happens on the original phone, with online adm… | WO-spec-3a (spec only) | Not implemented | todo |
| I-37 | An attendant's own correction received by the server before midnight (Africa/Lagos) on the… | WO-spec-3a (spec only) | Not implemented | todo |
| I-38 | An original sale arriving after midnight does not reopen editing | WO-spec-3a (spec only) | Not implemented | todo |
| I-39 | Optimistic version checks reject a correction based on an outdated revision | WO-spec-3a (spec only); WO-spec-4 (spec only); WO-spec-3b (spec only) | Not implemented; P-20 downstream checks above, not implemented | todo |
| I-40 | Retries never duplicate credit | WO-spec-4 (spec only) | Not implemented | todo |
| I-41 | Sensitive changes write an audit event with actor, target, previous and new values, reason… | WO-spec-3a (spec only); WO-spec-4 (spec only); WO-spec-3b (spec only) | Not implemented; P-20 downstream checks above, not implemented | todo |
| I-42 | Qualifying totals come from each purchase's current accepted revision, excluding cancelled… | WO-spec-4 (spec only); WO-spec-3b (spec only) | Not implemented; P-20 downstream checks above, not implemented | todo |
| I-43 | Rank by exact qualifying spend | WO-spec-4 (spec only) | Not implemented | todo |
| I-44 | All-time totals are kept separate from campaign-qualifying totals | WO-spec-4 (spec only) | Not implemented | todo |
| I-45 | Purchase cutoff, upload grace period and photo retention are configurable, versioned and a… | WO-spec-4 (spec only) | Not implemented | todo |
| I-45a | Which clock decides what | WO-spec-3a (spec only); WO-spec-4 (spec only); WO-spec-3b (spec only); WO-core-4a | capture-policy.test.ts: P-20 capped capture interval, campaign bounds and receipt deadline; sync-sales.test.ts: Monday outage and exact expiry | building (M1 capped interval; M3 review and M4 finalization remain) |
| I-46 | Finalization happens only after cutoff and grace have passed and all holds and reconciliat… | WO-spec-4 (spec only); WO-spec-3b (spec only) | Not implemented; P-20 downstream checks above, not implemented | todo |
| I-47 | Prize distribution stays manual | WO-spec-4 (spec only) | Not implemented | todo |
| I-48 | Photos live in private Spaces buckets per environment, under random paths with no names or… | WO-core-4 (upload/finalize) | storage.test.ts: Spaces virtual host/signing; sync-sales.test.ts: real MinIO immutable evidence | building (private upload/finalize implemented; admin signed reads and deployed smoke remain) |
| I-49 | The service worker caches only the generic capture shell and fonts | WO-app-2 (client); WO-spec-4 (spec only) | offline-capture.spec.ts (generic-only service-worker cache) | on-staging |
| I-50 | Cache only minimal customer lookup data on the phone | WO-app-2 (client); WO-core-4 (server) | client.test.ts (account-scoped lookup); offline-capture.spec.ts (cache exclusions); sync-sales.test.ts: minimal lookup has no phone data | on-staging |
| I-51 | Retention deletion runs only under an approved policy, skips pending evidence and active h… | WO-spec-4 (spec only) | Not implemented | todo |
| I-52 | Scheduled jobs are idempotent, bounded, leased and restartable | WO-spec-4 (spec only) | Not implemented | todo |

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
| Attendant 1 · Sign in and account | A01 A26 A12 A13 | WO-app-2, WO-core-3 | offline-capture-fidelity.md (client; real endpoint pending) | building |
| Attendant 2 · Record a sale (online) | A02 A24 A03 A04 | WO-app-2, WO-app-3 | offline-capture-fidelity.md (A02/A24/A03; A04 pending) | building |
| Attendant 3 · Offline sale and uploads | A27 A05 A08 A23 A14 | WO-app-2, WO-app-3, WO-app-8 | offline-capture-fidelity.md (A27/A05; uploads pending) | building |
| Attendant 4 · Register a customer | A06 A25 A07 | WO-app-6 | | todo |
| Attendant 5 · History and own correction | A09 A10 A11 | WO-app-7 | | todo |
| Attendant 6 · Cooking gas sale | A15 A16 | WO-app-2, WO-app-3 | offline-capture-fidelity.md (A15; A16 pending) | building |
| Attendant 7 · Pump reassignment | A17 | WO-app-5 | | todo |
| Attendant 8 · Offline access expired | A18 | WO-app-2 | offline-capture-fidelity.md; offline-capture.spec.ts | on-staging |
| Attendant 9 · Admin-assisted recovery | A19 A20 A21 A22 | WO-app-9 | | todo |
| Admin 1 · Sign in, first password, sign out | B01 B08 B09 B18 | WO-app-4 | | todo |
| Admin 2 · Password recovery | B10 B11 M02 B12 B13 | WO-app-4 | | todo |
| Admin 3 · Email verification | B14 M01 B15 B16 B17 | WO-app-4 | | todo |
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
| Admin 15 · Admin users | H01 H02 H09 H03 H04 | WO-app-4 | | todo |
| Admin 16 · Roles and permissions | H05 H06 H10 H08 H07 | WO-app-4 | | todo |

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
