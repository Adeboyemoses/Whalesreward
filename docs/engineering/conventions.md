# Conventions

## Stack and versions

As the TRD recommends: Next.js (App Router) + React + TypeScript (strict), Tailwind CSS for layout utilities over the vendored design system, Prisma with reviewed SQL migrations, Better Auth with database sessions and the username plugin, Dexie over IndexedDB, Workbox for the service worker, Vitest, Playwright and PostgreSQL integration tests, pnpm. Pin every version at scaffold time in the lockfile. Upgrades are their own PRs with tests. Nothing is chosen because it is newest.

Extras the TRD implies: `zod` (contracts), `sharp` (server-side image validation), `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (Spaces), `exceljs` and a PDF library for card exports (pick in the cards work order and log it), `qrcode` (QR payloads), `uuid` v7.

## Package scripts (canonical list)

WO-core-1 creates exactly these; everything else in the repo refers to them.

| Script | Does |
|---|---|
| `dev` / `build` / `start` | Next.js |
| `typecheck` | `tsc --noEmit` |
| `lint` / `format` | ESLint / Prettier |
| `test` | Vitest unit tests |
| `test:integration` | Vitest against Postgres (`DATABASE_URL`) |
| `test:time` | the time suite under `TZ=UTC` and `TZ=America/New_York` |
| `test:e2e` | Playwright against a local production build |
| `db:migrate:dev` / `db:migrate:deploy` | `prisma migrate dev --create-only` / `prisma migrate deploy` |
| `db:seed` | fixtures from `tests/fixtures/` |
| `job:<name>` | one scheduled job (`job:retention`, `job:orphans`, `job:reconcile-uploads`, `job:backup-manifest`) |

Run gates as `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

Every tool config (tsconfig, Vitest, ESLint, Prettier, Playwright, Tailwind content) excludes `.worktrees/**` and `product-docs/**`, or the main checkout will scan every worktree and the client folder.

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without a comment saying why.
- Domain errors are classes in `errors.ts` with a stable `code` (`operation_conflict`, `card_not_assignable`, `stale_revision`, `permission_denied`). Handlers map codes to HTTP: 400 validation, 401 no session, 403 permission, 404 not found, 409 conflict or stale version, 422 business rule.
- Exhaustive `switch` over status enums with a `never` check.

## Money and quantities

- Money is `bigint` kobo end to end, with a currency code (NGN) stored beside every amount. Over the wire it is a decimal string of kobo (`"2000000"`), parsed with `src/shared/money.ts`. Display through `formatNaira(kobo)` → `₦20,000.00`.
- Parse typed input as a string. Never through `Number()` or `parseFloat()`.
- Quantities are decimal strings over the wire and `Prisma.Decimal` on the server. Units are explicit (`litre`, `kilogram`). Display through `formatQuantity(q, unit, precision)` → `20 litres`, `5.25 kg`.
- Amount mode: keep the entered kobo exactly; derive quantity at the product precision for display only. Quantity mode: exact quantity × captured rate, round to kobo once (half-up is the proposed tie rule; it lives in one constant until D02 is closed).

## Time

- Server timestamps are `TIMESTAMPTZ` in UTC. The station calendar is Africa/Lagos (UTC+1, no DST). All calendar logic (midnight cutoff, "today", report days, campaign windows) goes through `src/server/lib/time.ts`, which takes an explicit instant and returns Lagos dates.
- Never read the process timezone. CI and Codex run with `TZ=UTC`; the time suite also runs under another TZ.
- Display format: `21 Oct 2026 · 10:42 AM`.

## IDs and codes

- UUIDv7 for primary keys and operation IDs. Card codes: seven characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, uppercase, unique, never reused. Display IDs (`STAFF002`, `CUST001`, `S001`, `BATCH001`) are sequences per type, shown in mono.

## API

- Page routes follow `product-docs/04 UI Design/Hi-Fi/screens.json` (T-11). Route handlers live under `src/app/api/<area>/…/route.ts`. Attendant endpoints under `/api/attendant/*` and `/api/sync/*`; admin under `/api/admin/*`. Each validates with a zod contract from `src/shared/contracts/`.
- Every mutation accepts an `Idempotency-Key` or an operation ID in the body, and is safe to retry.
- Responses never include phone numbers beyond what the screen shows (masked where the board masks them).

## Copy

Follow `product-docs/04 UI Design/Design System/README.md` ("Content fundamentals"): plain Nigerian English, second person, sentence case, **litres** and **kilograms**, no emoji, fixed status words. Copy strings for a screen live next to the screen, not in a global catalogue (one language for the MVP).

## Git

- Branches: `core/WHR-<n>-<slug>`, `app/WHR-<n>-<slug>`. Integration branch `staging`; production branch `main`.
- Commit messages: `<type>(<area>): <summary> (WHR-<n>)`, types `feat`, `fix`, `test`, `docs`, `chore`, `refactor`. Squash-merge into `staging`; merge-commit `staging` into `main`.
- Worktrees live in `.worktrees/<slug>` (gitignored). Run `pnpm install --frozen-lockfile` and `bash scripts/link-product-docs.sh` in a new worktree.

## Logging

`src/server/lib/logger.ts` (pino) with redaction paths for phone, password, code, token, signedUrl, authorization and cookie. Log events, not payloads: `purchase.accepted {purchaseId, revisionId, operationId}`.

## Dependencies

A new runtime dependency needs a one-line reason in the PR body and a check that its licence is MIT, Apache-2.0, BSD or ISC. No dependency that phones home. No analytics SDK.
