# Architecture

The TRD's architecture ("Recommended stack", "Architecture and boundaries"), turned into a concrete repository layout. The TRD says module names and paths are set in the implementation plan; this file is that plan's architecture part. Changing a boundary here is a decision: log it.

## Shape

One repository and one deployable **Next.js (App Router, TypeScript)** application: a modular monolith. Two surfaces on one origin, plus scheduled jobs from the same image.

```
Android attendant PWA ──┐                      ┌── Managed PostgreSQL (Prisma)
  (Dexie outbox, SW)    ├── Next.js on App ────┤
Admin browser ──────────┘   Platform (Node)    ├── Private Spaces: staging/ and final/ photo keys
         │                       │             ├── Email adapter (transactional provider; Mailpit in dev)
         └── presigned PUT ──────┼──> Spaces   └── Phone verification adapter (provider TBD, D06)
                                 │
              App Platform jobs (same image): retention · orphan cleanup · upload reconciliation · backup manifest
```

No Kubernetes, Redis, microservices, queues or always-on workers unless a measured need appears (TRD).

## Repository layout

```
AGENTS.md                      Codex doorway
.codex/                        Codex project config, agents (subagents), hooks
.agents/skills/                Codex skills
docs/agentic/                  operating model, soul, work orders, review, lane files
docs/engineering/              architecture, conventions, invariants, testing, roadmap, coverage map, decisions
docs/briefs/                   implementation briefs (one per hi-fi flow row)
docs/qa/                       smoke runbooks
.review/                       review evidence, one file per PR branch
product-docs -> …              symlink to the product folder (gitignored, read-only)

prisma/
  schema.prisma
  migrations/                  reviewed SQL, additive and forward-compatible
  seed.ts                      fictional fixtures only
src/
  app/
    (attendant)/attendant/     PWA routes = screens.json route_suggestion under /attendant
                               (/attendant/sign-in, /attendant/sale, /attendant/uploads, …); static client shells
    (admin)/admin/             portal routes = screens.json route_suggestion (/admin/overview, /admin/sales/:saleId, …)
    api/                       route handlers (thin): auth/, sync/, attendant/, admin/<area>/
  server/
    modules/<module>/          service.ts · repo.ts · errors.ts · *.test.ts
    lib/                       authz.ts · db.ts · time.ts · logger.ts · ids.ts · audit.ts
    adapters/                  storage (Spaces/MinIO) · email · phone-verification
    auth.ts                    Better Auth configuration
  shared/
    contracts/                 zod schemas and types shared by client and server (the lane contract)
    money.ts · quantity.ts     exact arithmetic and formatting (BigInt kobo, decimal quantities)
    status.ts                  sale status words and their pill variants
  client/
    offline/                   Dexie db, outbox, sync client, 24-hour window, photo pipeline, recovery
    sw/                        service worker source (Workbox), built to /attendant/sw.js
    api.ts                     typed fetch wrapper over the contracts
  ui/                          React wrappers over the design-system classes
  styles/design-system/        vendored tokens.css, bundle.css, fonts.css, fonts/
jobs/                          one entry per scheduled job: pnpm job:<name>
tests/
  integration/                 real Postgres, transactions and concurrency
  e2e/                         Playwright, local server, offline emulation
  fixtures/                    fictional data matching the hi-fi boards
  design-parity/               screenshots from the design-fidelity check
.do/                           App Platform specs (staging, production)
.github/                       CI, review-evidence check, PR template
```

## Server modules

| Module | Owns | Feature |
|---|---|---|
| `auth` | Better Auth wiring, sign-in, first password, sessions, revocation | F01, F12 |
| `access` | admin users, roles, permissions, delegation limits, last-Owner invariant, email verification and reset | F12 |
| `stations`, `pumps` | station hierarchy, pumps and their product | F01 |
| `prices` | product price versions, immediate activation, history | F04 |
| `attendants` | attendant accounts, assignment history and versions | F01 |
| `customers` | registration, normalized phone, category, phone change, recovery intake | F02, F08 |
| `cards` | batches, code generation, lifecycle, PDF and Excel exports, link, replace, retire | F03, F08 |
| `purchases` | original submission, idempotency, acceptance, credit | F04 |
| `sync` | submit, signed upload permission, finalize, status for the phone | F05 |
| `evidence` | staging and final keys, byte validation, digest, signed reads | F04 |
| `corrections` | revisions, midnight rule, late review | F06 |
| `reviews` | duplicate flags, price, card and date holds and their resolutions | F06, F07 |
| `recovery` | admin-assisted stranded-queue submission | F05 |
| `leaderboards` | qualifying totals, ranks by category | F09 |
| `giveaway` | finalization readiness, snapshots, revisions | F09 |
| `reports` | daily, attendant, pump and product reports, exports | F10 |
| `settings` | campaign window, upload grace, retention, versions | F11 |
| `retention` | approved deletion runs | F11 |
| `audit` | append-only audit events and their queries | all |

A module calls another module only through its `service.ts`. Repos are private to their module. Jobs and route handlers call services, never repos.

## Data model notes

The entity list is in the TRD ("Data model and integrity"). Non-obvious choices:

- Primary keys are UUIDv7 (`src/server/lib/ids.ts`), generated in the app. Printed card codes, staff codes (STAFF002) and sale numbers (S001) are separate display identifiers.
- `purchase` holds the immutable original (captured values, capture context, operation ID, originating account and assignment snapshot). `purchase_revision` holds each accepted or proposed version. `purchase.current_revision_id` points at the one that counts. Holds are rows in `purchase_hold` (kind: price, card, date), each resolved independently; any open hold means zero contribution.
- Suspected duplicates are rows in `duplicate_flag`, not holds: a flagged sale is still credited normally until an admin cancels it or clears the flag (I-40).
- Money columns are `BIGINT` named `*_kobo` with a `currency` column (NGN, pending client confirmation). Quantities are `NUMERIC(20,6)` with a `unit` enum (`litre`, `kilogram`) and the `quantity_precision` captured at sale time.
- Every timestamp is `TIMESTAMPTZ`. `app_captured_at` (phone claim) and `server_received_at` (truth) are separate columns. `verified_sale_date` is a nullable `DATE`.
- `audit_event` is append-only: the app's database role has no UPDATE or DELETE on it.
- Settings and prices are versioned tables (`*_version`) with `effective_from` from server time; reads take the version in force at the relevant moment.

## Two decisions the first work orders must settle

- **Offline shell (T-12).** Attendant routes are static client shells: no server-rendered personal data. Each page reads the session endpoint and Dexie on the client, so the service worker can precache the shell and launch it with no signal. Serwist or a custom Workbox build is picked in WO-app-2's plan.
- **One auth model for two kinds of user (T-13, proposed).** One Better Auth `user` table with `kind` (`attendant` | `admin`); attendants sign in by username only; admins have username and a verified email; profile, role and assignment data live in separate tables. Admin-assisted queue recovery on an attendant's phone uses a separate short-lived, single-purpose recovery grant, never a full admin session on the phone. WO-core-3's high-tier plan confirms or replaces this before code.

## Environments

| Environment | Runs | Data |
|---|---|---|
| Local | `pnpm dev` + `docker compose up` (Postgres, Mailpit, MinIO) | `prisma db seed` fixtures |
| CI | GitHub Actions with a Postgres service container | migrations from scratch, fixtures |
| Staging | Separate App Platform app, managed database, bucket, credentials, email sandbox | fictional data only |
| Production | Client-owned DigitalOcean account; one app instance, single-node database (TRD, pending HA decision) | live |

Staging and production don't exist yet. Provisioning them is T2 and waits for the client's cloud account (open question in Earl's register). Until then, `staging` is a branch, and smoke tests run locally or on the pilot phone through a tunnel Earl starts.

## Nested AGENTS.md

When a directory needs rules only its builders need, add a short `AGENTS.md` there (2 KB at most), for example `src/client/offline/AGENTS.md`. Codex concatenates them from the root down. The total for any path stays under Codex's 32 KiB limit.
