# Decisions index

Settled decisions, one line each. Read at session start. Full reasoning: product decisions live in the product docs (cited); technical decisions in [technical.md](technical.md). Add entries with the `log-decision` skill. Never edit a decision's meaning: supersede it with a new row.

## Product (settled by Earl and the client; source in product-docs)

| ID | Decision | Source |
|---|---|---|
| P-01 | One station MVP; personal attendant accounts assigned to station and pump; no shared pump logins, no manual shifts, no logout after each sale | F&R F01 |
| P-02 | Online sign-in, switching and registration; offline capture inside a session for 24 h after the last online sign-in, never renewed by reopening or reconnecting | F&R "Confirmed offline-use window" (D04) |
| P-03 | Credit needs resolved customer, complete details and a server-validated fresh photo; no routine approval for ordinary valid sales | F&R F04, F05 |
| P-04 | Spend-only ranking; equal spend shares rank; no transaction-count tie breaker; prizes manual | F&R F09 |
| P-05 | Own corrections before midnight (server receipt, Africa/Lagos) apply; later ones need admin review | F&R F06 |
| P-06 | Card batches Generated → Printed → Active; link only Active, unassigned, non-retired cards; export never changes status | F&R F03 |
| P-07 | Offline capture at a stale price is held for review (confirm, correct from meter, cancel, each with a reason) | D01 |
| P-08 | Two-decimal money; product-configurable quantity precision; amount mode keeps entered money; quantity mode rounds money once; no historical repricing; immediate price activation, no scheduling | D02 |
| P-09 | Cooking gas uses Cylinder automatically, in kg; liquids offer Vehicle, Keg, Three-wheeler, Bike; category stays fixed | D03 |
| P-10 | Admin reassigns pumps; attendant signs out and in online; old queues keep old context | D04 |
| P-11 | Admin-assisted recovery of stranded queues on the original phone, with reason and audit, followed by normal validation | D04 |
| P-12 | Replaced-card offline sales and unreliable-date sales are held with zero credit until a reasoned admin decision | D05 |
| P-13 | Giveaway finalization after cutoff, grace and resolved reviews saves a frozen snapshot; later changes make audited revisions | D05 |
| P-14 | Verified-email self-service password recovery for admins | F&R F12 |
| P-15 | Five sensitive permissions default to Owner and are granted separately (queueRecovery, cardEligibility, dateReview, giveawayFinalize, giveawayRevise); priceReview Owner by default | F&R "Confirmed permissions" |
| P-16 | All 106 hi-fi boards are the design scope, including every "added" board and Duplicate review's "Clear the flag · keep both" (not feature-flagged); board D03-AttendantProfile's Reset password and Disable account buttons are placeholders, left out | Earl, 4 Nov 2026 (Q-520) |
| P-17 | Spelling is "litres" and "kilograms" (design standard; client confirmation pending) | Design system README (Q-517) |

## Technical (this repo)

| ID | Decision | Since |
|---|---|---|
| T-01 | Stack as the TRD recommends: Next.js App Router modular monolith, Prisma + reviewed SQL, Better Auth, Dexie, Workbox, Vitest, Playwright, DigitalOcean App Platform + Managed Postgres + private Spaces | 2026-11-04 |
| T-02 | pnpm; Node pinned to the newest LTS App Platform supports | 2026-11-04 |
| T-03 | Repo layout and module boundaries as in architecture.md; lane contract in `src/shared/contracts` (zod) | 2026-11-04 |
| T-04 | Money is BigInt kobo with a currency code; quantities NUMERIC(20,6) with explicit unit; decimal strings over the wire | 2026-11-04 |
| T-05 | UUIDv7 primary keys and operation IDs; display codes separate | 2026-11-04 |
| T-06 | Design system vendored into `src/styles/design-system/`; Tailwind reads the same tokens; `wr-` classes are the component contract | 2026-11-04 |
| T-07 | Dev services: Postgres, Mailpit, MinIO in docker-compose; external providers behind adapters | 2026-11-04 |
| T-08 | Processes run with TZ=UTC; Lagos calendar only through `src/server/lib/time.ts` | 2026-11-04 |
| T-09 | Built with Codex: one EM session per lane and work order, builders and reviewers as Codex subagents, Linear team WHR, GitHub (private repo under Earl's adeboyemoses account) with `staging` and `main` | Earl, 2026-11-04 |
| T-10 | Halfway rounding in quantity mode is half-up until D02 closes; kept in one constant | 2026-11-04 (proposed in TRD) |
| T-11 | Routes follow `Hi-Fi/screens.json` route suggestions; attendant routes under `/attendant` (service-worker scope), admin under `/admin` | 2026-11-04 |
| T-12 | Attendant pages are static client shells reading Dexie and the session endpoint; no server-rendered personal data | 2026-11-04 |
| T-13 | Proposed: one Better Auth user table with `kind`, separate profile tables, short-lived recovery grant for queue recovery; WO-core-3 confirms | 2026-11-04 (proposed) |

## Open product decisions that touch code

D02 (meter settings, halfway rounding, capture-start trust), D05 (other retirement cases), D06 (role matrix, token expiries, providers, loss-of-email process), D07 (photo originals, backups, restore objectives), D08 (field validation), D09 (campaign dates, grace, retention values). See `product-docs/06 Delivery and Handoffs/Design Handoff Readiness.md`. Build them behind configuration or adapters; never invent the client's policy.
