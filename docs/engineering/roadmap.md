# Roadmap

Milestones follow the proposal's delivery stages and the TRD's recommended sequence ("prove one vertical flow on a real Android device" first). Rook turns each line into a Linear work order in team `WHR`, project **Whales Rewards MVP**; Earl approves each one before a session may start it. Dates are targets, not commitments: the proposal estimates five to six weeks from kickoff, and the client discussed a November launch for a December giveaway (see the launch-date question in Earl's register).

| Milestone | Proposal stage | Target |
|---|---|---|
| M0 Foundation | 1 Scope and design (closing) | wk 1 |
| M1 Vertical slice on a real phone | 2 Core purchase flow | wk 1–2 |
| M2 Accounts, station and cards | 3 Administration and controls | wk 2–3 |
| M3 Exceptions, corrections and audit | 3 | wk 3–4 |
| M4 Leaderboards, reports and giveaway | 3 | wk 4–5 |
| M5 Staging, pilot, launch | 4 Acceptance and launch | wk 5–6 |

## M0 Foundation

- **WO-core-1 Repository scaffold.** On the `staging` branch Earl created (setup.md): Next.js + TypeScript strict, pnpm, ESLint, Prettier, Vitest, Playwright, Prisma, docker-compose (Postgres, Mailpit, MinIO), the canonical package scripts (conventions.md), `.env.example`, tool configs excluding `.worktrees/**` and `product-docs/**`, CI green. Done means: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:integration` green locally and in CI on an empty app, plus both gate self-tests.
- **WO-app-1 Design system and app shells.** Vendor tokens, bundle and fonts; Tailwind over the tokens; `src/ui/` components with a component gallery route (dev only); the attendant shell (AppHeader, BottomNav) and the admin shell (Sidebar) at 390 and 1440 px. Done means: the gallery matches each `components/<Name>/preview.html`.
- **WO-core-2 Core schema and shared maths.** Station, pump, product, price version, attendant account and assignment, customer, card batch and card, purchase, revision, hold, photo asset, audit event; `src/shared/money.ts`, `quantity.ts`, `src/server/lib/time.ts`, `ids.ts`, `logger.ts`; seed with the board fixtures. Done means: invariant tests for money, quantity and time (I-29, I-44, I-37 helpers) pass under two TZs.

## M1 Vertical slice (TRD step 1)

- **WO-core-3 Attendant auth.** Better Auth with database sessions, username sign-in for admin-provisioned attendant accounts (seeded), session endpoint exposing assignment and price, sign-out, revocation. Boards A01, A26, A12, A13.
- **WO-app-2 Offline capture.** Dexie store partitioned by account, the outbox, the 24-hour window, camera capture and compression, the sale screen in both entry modes, card lookup by QR and code. Boards A02, A24, A03, A27, A05, A15, A18.
- **WO-core-4 Sync and credit.** Card lookup by code or QR (name, category, the minimal cache payload; I-17, I-50), submit, signed staging upload, finalize with byte validation and the final key, acceptance and credit once, status endpoint. Invariants I-17, I-22 to I-28.
- **WO-app-3 Uploads and confirmation.** Pending uploads, retry, synced receipt, empty state, gas receipt. Boards A04, A08, A23, A16.
- **Exit:** the TRD's step 1 on a real Android phone. Camera and service worker need a secure context, so the phone reaches the dev machine through `adb reverse tcp:3000 tcp:3000` and `adb reverse tcp:9000 tcp:9000` (localhost counts as secure; presigned MinIO URLs use `http://localhost:9000`). A public tunnel is a third-party service: T2, Earl's go. The test: online sign-in, QR and manual lookup, fresh photo, offline save, restart, reconnect, signed upload, exactly one credit. Earl smoke-tests from the runbook.

## M2 Accounts, station and cards (TRD step 2)

- **WO-core-5 Admin access.** Admin users, roles, permissions (28, deny by default), delegation limits, last Owner, first password, sign-out, verified-email recovery and verification with the two emails (Mailpit in dev). Boards B01, B08, B09, B18, B10–B17, M01, M02, H01–H10.
- **WO-app-4 Admin access screens.** The same boards in the portal.
- **WO-core-6 / WO-app-5 Station, attendants and prices.** Pumps, product prices with immediate activation and history, attendant accounts and pump assignment with fresh sign-in. Boards F01–F10, D01–D04, A17.
- **WO-core-7 / WO-app-6 Customers and cards.** Online registration with duplicate phone, card batches Generated → Printed → Active, code generation, PDF print sheet, Excel register, print preview; customer list, profile and purchases. Boards A06, A25, A07, B06, K01–K06, C01, B05, S08.

## M3 Exceptions, corrections and audit (TRD step 3)

- **WO-core-8 / WO-app-7 Corrections and history.** Own correction before midnight, late correction review, sales history and details. Boards A09–A11, S01, B03, B04.
- **WO-core-9 / WO-app-8 Holds and reviews.** Duplicate review (including "Clear the flag · keep both"), price review and correction, replaced-card review, sale-date review, decision recorded. Boards A14, S02–S04, S06, S07, S09.
- **WO-core-10 / WO-app-9 Customer changes and queue recovery.** Phone change, card replacement with registered-phone verification, lost-card-and-phone manager review, change applied (I-21, I-21a); admin-assisted queue recovery on the original phone. Boards C02–C05, A19–A22. Phone change and card replacement need the verification provider (D06): build behind the adapter with the console provider until Earl decides.
- **WO-core-11 / WO-app-10 Audit history.** Boards G01–G05.

## M4 Leaderboards, reports and giveaway (TRD step 4)

- **WO-core-12 / WO-app-11 Leaderboards and finalization.** Overall and category ranks, finalization readiness, snapshot, revision. Boards E01–E04.
- **WO-core-13 / WO-app-12 Reports and overview.** Daily, attendant, pump and product reports with PDF and Excel exports; overview KPIs and attention cards. Boards E05–E07, B02.
- **WO-core-14 / WO-app-13 Settings.** Giveaway timing and photo retention with review steps. Boards B07, T01–T04.
- **Exit:** every board implemented; the "scoped application demonstrated in staging" milestone, which needs M5's staging environment. If the client's DigitalOcean account isn't ready, Earl decides whether to demo from a Cloudrock-owned temporary staging (T2).

## M5 Staging, pilot and launch (TRD step 5)

- **WO-core-15 Staging environment.** App Platform specs, managed Postgres, private Spaces, email sandbox, secrets, deploy pipeline, migration on deploy. Provisioning is T2: Earl's go and the client's account.
- **WO-core-16 Operations.** Scheduled jobs (retention, orphan cleanup, upload reconciliation, backup manifest), independent backup destination, restore drill, monitoring and uptime check, log redaction audit.
- **WO-app-14 Pilot fixes.** Findings from the station pilot (real cards, meter photos, daylight, handover, outages).
- **WO-core-17 Production and handover.** Production environment (T2), promotion, training material, operating guide, deployment and recovery notes, handover package.
