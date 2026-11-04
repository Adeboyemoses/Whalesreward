# Coverage map

Where each requirement stands. The EM updates the rows its work order touched at session close (`close-session` skill). Status: `todo` → `building` → `on-staging` → `accepted`. A row reaches `on-staging` only with a named test (invariants) or a design-parity check (boards).

## WO-spec-1 documentation status (WHR-32)

Data-model PR #4 is merged on staging with independent security and integrity PASS verdicts. M1 contracts PR #5 is merged with independent security and integrity PASS verdicts; lane setup and closeout complete when PR #1 merges. These are specification changes only: no invariant implementation or built-screen parity is claimed; test and board statuses remain unchanged.

## Invariants

| ID | Rule (short) | Work order | Test | Status |
|---|---|---|---|---|
| I-01 | Each attendant has a personal account: name, unique username, password and a permanent sys… | | | todo |
| I-02 | Sign-in, account switching and customer registration need connectivity | | | todo |
| I-03 | Offline capture is allowed for 24 hours after the last successful online sign-in | | | todo |
| I-04 | An account writes only for its authorized station and pump | | | todo |
| I-05 | Pump reassignment is done by an authorized admin | | | todo |
| I-05a | A queued record from before a reassignment is validated against that account's assignment … | | | todo |
| I-06 | Logout offers upload-first when connected | | | todo |
| I-07 | Admin users, roles and permissions are separate from attendant accounts | | | todo |
| I-08 | At least one active Owner always exists | | | todo |
| I-09 | Disabling an account or removing a permission revokes it on active sessions | | | todo |
| I-10 | A role administrator cannot grant more authority than they hold | | | todo |
| I-11 | Five sensitive permissions default to Owner only and are granted separately: `queueRecover… | | | todo |
| I-12 | Admin password recovery uses a verified email only | | | todo |
| I-13 | New admin accounts start with a temporary password and must change it at first sign-in | | | todo |
| I-14 | Registration captures name, phone and a fixed category: car owners, commercial bus drivers… | | | todo |
| I-15 | Phone numbers are normalized before the uniqueness check | | | todo |
| I-16 | Card codes are unique across all batches, collision-retried, reserved before print export … | | | todo |
| I-17 | QR scan and typed code resolve the same card | | | todo |
| I-18 | Batch lifecycle is Generated → Printed → Active, forward only, server-validated, audited w… | | | todo |
| I-19 | A card can be linked only when its batch is Active and the card is unassigned and not reti… | | | todo |
| I-20 | PDF print sheets and Excel registers are generated from the reserved codes | | | todo |
| I-21 | Card replacement keeps the customer and retires the old card atomically | | | todo |
| I-21a | Before replacing a lost card, the admin verifies a code sent to the registered phone (thro… | | | todo |
| I-22 | Every sale has a client-generated operation ID | | | todo |
| I-23 | The sale and its photo blob are saved atomically in IndexedDB before the phone shows "Save… | | | todo |
| I-24 | Photos come from the live in-app camera only | | | todo |
| I-25 | Uploads go to a unique staging path through a short-lived signed permission scoped to that… | | | todo |
| I-26 | Credit needs: resolved customer, complete details, validated photo, price checks and eligi… | | | todo |
| I-27 | A definitive "customer not found" cancels the record with a reason | | | todo |
| I-28 | Store app capture time and server receipt time separately | | | todo |
| I-29 | Amount entry is the default; Quantity entry is available | | | todo |
| I-30 | Liquids offer Bought into: Vehicle, Keg, Three-wheeler, Bike | | | todo |
| I-31 | A sale is held for price review, with zero credit, only when its captured rate is an unres… | | | todo |
| I-32 | Price activation is immediate on server confirmation, one price per product for the statio… | | | todo |
| I-33 | A sale uploaded against a card replaced before upload is held for card-eligibility review … | | | todo |
| I-34 | A sale with an unreliable capture date is held until an admin records an evidence-supporte… | | | todo |
| I-35 | Each hold (price, card, date) clears only itself | | | todo |
| I-36 | Admin-assisted recovery of a stranded queue happens on the original phone, with online adm… | | | todo |
| I-37 | An attendant's own correction received by the server before midnight (Africa/Lagos) on the… | | | todo |
| I-38 | An original sale arriving after midnight does not reopen editing | | | todo |
| I-39 | Optimistic version checks reject a correction based on an outdated revision | | | todo |
| I-40 | Retries never duplicate credit | | | todo |
| I-41 | Sensitive changes write an audit event with actor, target, previous and new values, reason… | | | todo |
| I-42 | Qualifying totals come from each purchase's current accepted revision, excluding cancelled… | | | todo |
| I-43 | Rank by exact qualifying spend | | | todo |
| I-44 | All-time totals are kept separate from campaign-qualifying totals | | | todo |
| I-45 | Purchase cutoff, upload grace period and photo retention are configurable, versioned and a… | | | todo |
| I-45a | Which clock decides what | | | todo |
| I-46 | Finalization happens only after cutoff and grace have passed and all holds and reconciliat… | | | todo |
| I-47 | Prize distribution stays manual | | | todo |
| I-48 | Photos live in private Spaces buckets per environment, under random paths with no names or… | | | todo |
| I-49 | The service worker caches only the generic capture shell and fonts | | | todo |
| I-50 | Cache only minimal customer lookup data on the phone | | | todo |
| I-51 | Retention deletion runs only under an approved policy, skips pending evidence and active h… | | | todo |
| I-52 | Scheduled jobs are idempotent, bounded, leased and restartable | | | todo |

## WO-app-0 documentation preparation (WHR-33)

Earl’s 4 November findings: app-2/app-3 runbooks now split at local durable save versus server confirmation; row 02 includes I-03 capture/save guards and omits unavailable M2 registration navigation. These remain unexecuted drafts; coverage statuses below are unchanged.

Rows 1, 2, 3, 6 and 8 have implementation briefs and draft phone runbooks prepared against their board PNGs and decision notes. This is documentation preparation only: it implements no invariant and establishes no built-screen parity. Tests and board statuses below remain todo until the respective implementation work orders verify them. Proposed M1 contract names remain TODO-CONTRACT pending WO-spec-1.

## WO-core-2 foundation coverage (WHR-3)

Database constraints and pure helpers support the following invariants; they do not establish complete feature coverage. Their existing invariant rows remain todo until the relevant services and client flows are implemented and verified. No board parity is claimed.

| Foundation | Invariants supported | Named tests | Status |
|---|---|---|---|
| Exact kobo and captured-precision quantity arithmetic | I-29 | src/shared/money.test.ts; src/shared/quantity.test.ts | building |
| Explicit Lagos receipt/midnight helper | I-37, I-38 | tests/time/lagos.time.test.ts (UTC and America/New_York) | building |
| Unit-separated quantities | I-44 | src/shared/quantity.test.ts | building |
| Entity storage, normalized-phone uniqueness, fixed categories and product units | I-14, I-15, I-29, I-30 | tests/integration/schema-contract.test.ts | building |
| Immutable originals, append-only audit and operation uniqueness | I-22, I-28, I-41 | tests/integration/core-schema.test.ts | building |

## Hi-fi boards (106, in canvas row order)

| Row | Boards | Work order | Parity check | Status |
|---|---|---|---|---|
| Attendant 1 · Sign in and account | A01 A26 A12 A13 | WO-core-3 | | todo |
| Attendant 2 · Record a sale (online) | A02 A24 A03 A04 | WO-app-2, WO-app-3 | | todo |
| Attendant 3 · Offline sale and uploads | A27 A05 A08 A23 A14 | WO-app-2, WO-app-3, WO-app-8 | | todo |
| Attendant 4 · Register a customer | A06 A25 A07 | WO-app-6 | | todo |
| Attendant 5 · History and own correction | A09 A10 A11 | WO-app-7 | | todo |
| Attendant 6 · Cooking gas sale | A15 A16 | WO-app-2, WO-app-3 | | todo |
| Attendant 7 · Pump reassignment | A17 | WO-app-5 | | todo |
| Attendant 8 · Offline access expired | A18 | WO-app-2 | | todo |
| Attendant 9 · Admin-assisted recovery | A19 A20 A21 A22 | WO-app-9 | | todo |
| Admin 1 · Sign in, first password, sign out | B01 B08 B09 B18 | WO-app-4 | | todo |
| Admin 2 · Password recovery | B10 B11 M02 B12 B13 | WO-app-4 | | todo |
| Admin 3 · Email verification | B14 M01 B15 B16 B17 | WO-app-4 | | todo |
| Admin 4 · Overview | B02 | WO-app-12 | | todo |
| Admin 5 · Sales and exception reviews | B03 B04 S01 S02 S03 S04 S06 S07 S09 | WO-app-7, WO-app-8 | | todo |
| Admin 6 · Customers and account changes | C01 B05 S08 C02 C03 C04 C05 | WO-app-6, WO-app-9 | | todo |
| Admin 7 · Loyalty cards | B06 K01 K04 K02 K05 K06 K03 | WO-app-6 | | todo |
| Admin 8 · Attendants and pump assignment | D01 D02 D04 D03 F04 F09 F10 | WO-app-5 | | todo |
| Admin 9 · Station pumps | F01 F02 F03 | WO-app-5 | | todo |
| Admin 10 · Product prices | F05 F06 F07 F08 | WO-app-5 | | todo |
| Admin 11 · Leaderboards and finalization | E01 E02 E04 E03 | WO-app-11 | | todo |
| Admin 12 · Reports | E05 E06 E07 | WO-app-12 | | todo |
| Admin 13 · Audit history | G01 G02 G03 G04 G05 | WO-app-10 | | todo |
| Admin 14 · Settings | B07 T01 T03 T02 T04 | WO-app-13 | | todo |
| Admin 15 · Admin users | H01 H02 H09 H03 H04 | WO-app-4 | | todo |
| Admin 16 · Roles and permissions | H05 H06 H10 H08 H07 | WO-app-4 | | todo |

D03-AttendantProfile's **Reset password** and **Disable account** buttons are placeholders, not scope, until a work order covers them.
