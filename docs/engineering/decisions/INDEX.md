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

| P-20 | Supersedes P-18 interval/review rule (lower bound superseded by P-23 on 2026-11-09): evaluate [L, min(R, original offlineExpiresAt)] across price, assignment and campaign history; late receipt alone causes no hold. Evidence-backed M3 capture review requires sales AND dateReview, confirms only capture authorization/time blocks or cancels, rerunning all other gates. No boolean or automatic clearing; one server module; Q-528 pending. Retains P-18’s refinement of P-07 | Earl, 5 Nov 2026; [WHR-61](https://linear.app/phaneum/issue/WHR-61), refining WHR-38/WHR-52 |
| P-19 | Recovered unverified corrections require ordinary late review by sales AND corrections admin distinct from executor and grant authorizer; only that decision clears proposal block, never automatic treatment. Refines P-11 | Earl, 4 Nov 2026; WHR-46 and WHR-52 |
| P-21 | Offboarding ends the attendant's pump assignment: no active assignment refuses sign-in/capture; ending it revokes all sessions, preserving history and queues under P-20. Extends P-10; retains P-16's excluded disable/reset controls and no pump deactivation. Guarded endpoint and recovery rules are in [M2](../contracts/m2.md#assignment-ending-offboarding--p-21-wo-spec-2a-whr-79); attendant disable is a possible later client addition, not approved scope | Earl, 6 Nov 2026; [WHR-76 decision](https://linear.app/phaneum/issue/WHR-76), [WHR-79](https://linear.app/phaneum/issue/WHR-79) |

| P-22 | Attendant corrections change only the entered amount or quantity in the sale's recorded basis against its retained validated meter photo. Card, customer, medium, product, pump, rate and photo are not attendant-correctable; other mistakes use existing authorized admin review/cancel paths. Configures the M3 correction-evidence policy for numeric-only corrections; other correction kinds remain out of scope. Refines P-05; preserves P-19 independent recovered review | Earl, 9 Nov 2026; [WHR-47 Option A](https://linear.app/phaneum/issue/WHR-47), [WHR-84](https://linear.app/phaneum/issue/WHR-84). Rook to mirror in product docs |

| P-23 | Supersedes only P-20's unconditional S lower bound: verified server-HMAC lookup/registration evidence gives L=max(S,T), otherwise L=S; all capture checks use [L,min(R,original expiry)], with card link still in force at R. Preserves P-20 cap/review permissions and Q-528 gate. Cached evidence keeps its original time; invalid/mismatched evidence falls back without rejection. Prevents ordinary register-then-sell holds under P-02's app-integrity boundary | Earl, 9 Nov 2026; [WHR-91](https://linear.app/phaneum/issue/WHR-91), [M1](../contracts/m1.md#signed-lookup-lower-bound--p-23-wo-spec-3d-whr-91). Rook to mirror in product docs |

| P-24 | Flag distinct non-cancelled station sales for the same customer, product and exact entered value in the same basis within a configured 10 minutes by app-reported capture time, OR byte-identical server-validated photo digests regardless of customer/time. Flags never hold or change credit; phone time grants no eligibility. Missing window disables only time-based matching. Refines F07; client Q-555 pending | Earl, 11 Nov 2026; [WHR-102](https://linear.app/phaneum/issue/WHR-102), [M3](../contracts/m3.md#duplicate-and-independent-hold-decisions--s02s07). Rook to mirror in product docs |

| P-25 | review-evidence-v1 admits only closed server-recorded references and traceable same-sale conclusions. Price accepts only a rate valid throughout I; no price cancellation; WHR-50 specification gate superseded by P-26 on 2026-11-12, with runtime activation still separate. Card confirms U<E, cancels L>=E; date requires one Lagos day; capture confirms all open uniform blocks and cancels only uniformly unauthorized capture. Refines P-07/P-12/P-20/P-23 evidence sufficiency; retains other guards. Q-556/Q-528 pending; Q-557 undecided | Earl, 11 Nov 2026; [WHR-103](https://linear.app/phaneum/issue/WHR-103), Option A [WHR-105](https://linear.app/phaneum/issue/WHR-105), [WHR-106](https://linear.app/phaneum/issue/WHR-106), [WHR-107](https://linear.app/phaneum/issue/WHR-107), [WHR-108](https://linear.app/phaneum/issue/WHR-108), [WHR-109](https://linear.app/phaneum/issue/WHR-109); [M3 amendment](../contracts/m3.md#duplicate-and-independent-hold-decisions--s02s07). Rook to mirror in product docs |

| P-26 | Supersedes P-25's unresolved WHR-50 meter gate only: correct_meter requires one historical rate throughout I and exact display allowance D≤r×sQ/2+sA/2 from approved immutable server profiles. No business tolerance or pre-comparison rounding; preserve exact transcriptions and T-10. One live sales AND priceReview admin, existing independence retained. Q-559 measurements/verification and separate implementation/activation remain required; [M3](../contracts/m3.md#meter-reconciliation--p-26) is normative | Earl, 12 Nov 2026; [WHR-50](https://linear.app/phaneum/issue/WHR-50), [WHR-112](https://linear.app/phaneum/issue/WHR-112), [WHR-118](https://linear.app/phaneum/issue/WHR-118), [WHR-119](https://linear.app/phaneum/issue/WHR-119), [WHR-120](https://linear.app/phaneum/issue/WHR-120), [WHR-121](https://linear.app/phaneum/issue/WHR-121), [WHR-122](https://linear.app/phaneum/issue/WHR-122), [WHR-124](https://linear.app/phaneum/issue/WHR-124). Rook to mirror in product docs |

| P-27 | Online phones learn current acknowledged-pump prices through existing session reads and opt-in card lookup, using strict legacy-tolerant shapes. New drafts adopt the snapshot with a notice; composed drafts keep their price with a warning (recommended), and saved/queued/settled sales never change. Extends P-08 distribution; preserves P-20/P-23 bounds, offline behavior, T-10 and all settlement gates. No price polling | Earl, 12 Nov 2026; [WHR-125](https://linear.app/phaneum/issue/WHR-125), [M1](../contracts/m1.md#online-price-refresh--p-27-wo-spec-3l-whr-125). Rook to mirror in product docs; separate core/app implementation |

| P-28 | Only the live Owner with settings permission creates the station's campaign and sets/changes launch, start, cutoff, timezone and whole nonnegative grace in Settings through reasoned review → confirm, digest/version checks and immutable before/after audit/history. Changes require now before both current/proposed start and no saved snapshot; inclusive launch/start/cutoff/deadline, no in-progress amendment. Supersedes M4's no-create/no-launch-start setter and WHR-55 timing-policy default, not P-13 snapshot immutability or retention deletion gates. Recorded campaign-timing-v1 configures policy; values come from the Owner, with no seeded dates/env switch | Whales' Q-572/Q-574 answers, 13 Nov 2026, relayed by Earl on [WHR-133](https://linear.app/phaneum/issue/WHR-133); Earl's approved [WHR-138](https://linear.app/phaneum/issue/WHR-138), 14 Nov 2026; settles [WHR-55](https://linear.app/phaneum/issue/WHR-55) Option A. [M4](../contracts/m4.md#owner-setup-and-lock--p-28) normative; Rook to mirror in product docs |

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
| T-14 | Confirm T-13: one Better Auth user with `kind`, separate profiles and revocable database sessions behind attendant wrappers; recovery grants remain separate and deferred. Supersedes T-13 proposal | 2026-11-05 (WO-core-3 plan) |

| T-17 | Supersedes T-15: staging uses Zoho CPaaS US; allow only exact US/EU send URLs, accept HTTP 200/201 with EM_104, require a raw token and emit safe failure/startup codes; production remains disabled pending WHR-42 | Earl, 2026-11-06; WHR-73 direct API evidence |

| T-16 | Run bounded admin-mail polling inside the existing web process with explicit provider opt-in, durable message leases and graceful shutdown; no extra paid component | EM choice delegated by Earl, 2026-11-06; WHR-68 |

| T-18 | Render immutable card snapshots locally with pdf-lib 1.17.1, ExcelJS 4.4.0 and node-qrcode 1.5.4 (MIT); keep physical layout and phone policy behind D08 configuration | EM choice under approved WHR-12, 2026-11-09 |

| T-19 | Review-evidence operator commands require the current database's persisted database-level `whr.environment`, set once by Earl with the admin user; refuse missing or mismatched identity and ignore session/role overrides | Earl, 12 Nov 2026; [WHR-116 Option A](https://linear.app/phaneum/issue/WHR-116), WHR-114 |

## Open product decisions that touch code

D02 (Q-559 verified meter display steps pending; P-26 retains T-10 halfway rounding; capped capture build default P-20 (refines P-18) awaits Q-528 client confirmation), D05 (other retirement cases), D06 (role matrix, token expiries, providers, loss-of-email process), D07 (photo originals, backups, restore objectives), D08 (field validation), D09 (P-28 settles timing setup/change policy; campaign dates/timezone/grace await Owner entry; retention values and deletion policy remain separate). See `product-docs/06 Delivery and Handoffs/Design Handoff Readiness.md`. Build them behind configuration or adapters; never invent the client's policy.
