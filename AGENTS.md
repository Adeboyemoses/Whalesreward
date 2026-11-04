# AGENTS.md

Codex reads this first, every session. Keep it under 10 KB; everything else is read on demand.

**Whales Rewards** is the one-station fuel and cooking-gas loyalty MVP that Cloudrock Technologies is building for Whales Empire (brand: Whales Energy). It has two surfaces in one Next.js app: the **attendant PWA** (Android phones, outdoors, often offline) and the **admin portal** (desktop). "Build X" means code unless the work order says otherwise.

## Read at session start (about 35 KB in all)

1. This file.
2. [docs/agentic/soul.md](docs/agentic/soul.md): the principles you must not break, and who may do what (T0–T3).
3. [docs/engineering/invariants.md](docs/engineering/invariants.md): the product rules the code must enforce.
4. [docs/engineering/decisions/INDEX.md](docs/engineering/decisions/INDEX.md): settled decisions.
5. Your lane file: `docs/agentic/lanes/<lane>.md`.

Read on demand: [architecture](docs/engineering/architecture.md), [conventions](docs/engineering/conventions.md), [design system](docs/engineering/design-system.md), [testing](docs/engineering/testing.md), [roadmap](docs/engineering/roadmap.md), [coverage map](docs/engineering/coverage-map.md), [work orders](docs/agentic/work-orders.md), [review and evidence](docs/agentic/review.md), and [the operating model](docs/agentic/README.md).

## Product docs (read-only, outside the repo)

`product-docs/` is a symlink to the client's product folder in Earl's Cowork workspace. It is gitignored and never shipped. It is the source of truth for **what** to build. This repo is the source of truth for **how** it is built.

| Need | Read |
|---|---|
| Product rules F01–F12, confirmed decisions, deferred scope | `product-docs/03 Features and Requirements/Features and Requirements.md` |
| Stack, data model, sync protocol, security, infra | `product-docs/Technical Requirements/Technical Requirements.md` |
| Open decisions D01–D09 and the pilot validation list | `product-docs/06 Delivery and Handoffs/Design Handoff Readiness.md` |
| Every screen (106 hi-fi boards, in flow order) | `product-docs/04 UI Design/Hi-Fi/README.md`, then `Hi-Fi/{Attendant,Admin}/<ID>.html` + `.png` |
| Screen inventory: routes, states, links, classes | `product-docs/04 UI Design/Hi-Fi/screens.json` |
| Design build rules for UI work | `product-docs/04 UI Design/Hi-Fi/AGENTS.md`, then `product-docs/06 Delivery and Handoffs/Design Build Guide.md` |
| Per-screen behaviour and edge cases | `product-docs/04 UI Design/{Attendant Mobile,Admin Portal}/* Decisions.md` |
| Brand, tokens, components | `product-docs/04 UI Design/Design System/README.md`, `tokens.css`, `bundle.css` |

- Never edit, move or write anything under `product-docs/`. If the docs are wrong or silent, raise it (see "Questions" below).
- Ignore `05 Commercials and Proposals/` and `01 Brief and Discovery/`. They are not engineering inputs.
- Search with `rg -L --no-ignore "<term>" product-docs/`. Paths contain spaces, so always quote them. Open PNG boards with your image viewer.
- In a worktree, `product-docs/` is missing. Run `bash scripts/link-product-docs.sh` once inside the worktree.
- App code, tests and CI must never import from `product-docs/`. Copy what you need into the repo (the design system is vendored under `src/styles/design-system/`).
- When the requirements and a hi-fi board disagree on behaviour, the newer decision note wins, then the requirements, then the board. Record the conflict in the PR body.
- This repo overrides the design handoff in four places: attendant routes are `screens.json` routes under `/attendant` (`/attendant/sale`); tap targets are 48 px on the phone (44 px is the floor); the added boards are approved, so nothing is feature-flagged for Q-520 and D03-AttendantProfile's two placeholder buttons are left out; questions go to Linear `needs:human`, not the Cowork register.

## Session protocol

Each session is the **engineering manager (EM)** ([role](docs/agentic/README.md#the-engineering-manager)) for **one lane** and **one approved work order** from Linear team `WHR`.

| Lane | Owns | Builders |
|---|---|---|
| `lane:core` | `prisma/**` (holds `lock:schema`), `src/server/**`, `src/app/api/**`, `src/shared/**` (contracts, money, quantity), `jobs/**`, `scripts/**`, `.github/**`, `.do/**`, `docker-compose.yml`, root tooling config | backend-engineer, platform-engineer, test-engineer |
| `lane:app` | `src/app/(attendant)/**`, `src/app/(admin)/**`, `src/client/**` (incl. `api.ts`), `src/ui/**`, `src/styles/**`, `public/**`, the web manifest, `docs/briefs/**` | frontend-engineer, offline-engineer, test-engineer |

| `lane:spec` | `docs/engineering/data-model.md`, `docs/engineering/contracts/**`, `docs/engineering/coverage-map.md`, `docs/engineering/decisions/**`, `docs/agentic/lanes/spec.md`; triages `needs:human` | EM writes docs; no builders |

Code lanes change a contract only through a `lane:spec` child issue or a PR that updates the contract doc in the same change. The spec lane never writes app code; independent reviewers still review its specs.

Tests live with the lane of the code they test. `lane:app` may propose a `src/shared/**` change; `lane:core` reviews and merges it.

- Work only the children of the work order named in the session prompt, and only if it carries Earl's approval line ([rules](docs/agentic/work-orders.md#approval)). No work order: ask Earl for one. Don't pick work yourself.
- The EM coordinates. It writes code only for fixes of about 10 lines, docs, git operations and triage. Builders (`.codex/agents/*.toml`) write feature code, each in its own worktree under `.worktrees/`. Nobody runs `git checkout` or `git switch` in the main checkout.
- If subagents are unavailable in your Codex surface, run each builder or reviewer as a separate Codex thread with that agent's instructions. **Never review a diff in the thread that wrote it.**
- Found work becomes a Linear issue labelled `found-in:<WO>`, never extra scope.
- At session close, overwrite your lane file (3 KB at most, metric line last) and update `STATUS.md`.

## Risk tiers (full rules: [review.md](docs/agentic/review.md))

| | Low | Medium | High |
|---|---|---|---|
| Typical diff | Presentational UI, copy, tests only, docs | New or changed endpoint, UI wired to the API, reports and leaderboard queries, additive migration, card batches | Auth, sessions, roles and permissions, tokens, email verification and reset; purchase acceptance and credit, revisions, corrections, reviews and holds, finalization; offline outbox, IndexedDB schema, service worker, sync and finalize endpoints; evidence storage and signed URLs; money and quantity maths; destructive migrations; retention and deletion; CI, hooks, agent files |
| Reviewers | code-reviewer | code-reviewer + one of integrity-reviewer or security-reviewer | code-reviewer + security-reviewer + integrity-reviewer |
| Round cap | 2 | 2 | 3 |
| Blocks merge | P0, SEC-HIGH | P0, SEC-HIGH | P0, SEC-HIGH, INTEGRITY-P1 |

`bash scripts/review/required-reviewers.sh origin/staging...HEAD` computes the minimum tier and the reviewers. You may raise a tier, never lower it.

## Gates

- **Evidence or no merge.** `.review/<branch with / as __>.md` is committed in the PR ([format](.review/README.md)). The `review-evidence` CI check enforces it.
- Re-run every gate yourself on the final head before opening a PR. A builder's "green" is unverified. Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, plus `pnpm test:integration` when `prisma/**` or `src/server/**` changed and `pnpm test:e2e` when a user flow changed.
- The EM merges reviewed PRs into `staging`. **`staging` → `main`: the EM opens the promotion PR and Earl merges it himself.** The EM merges it only on Earl's explicit go in the current session naming the PR, with `WHR_MAIN_GO=<today>`, and records his words in the lane file.
- Nobody bypasses the review gate from Codex. If Earl wants a bypass, he merges it himself in GitHub.

## Standing rules

- **This repository is public.** Never commit client data, personal data, commercial terms (fees, invoices, payment milestones), credentials, or copies of product-docs text beyond what the code needs. Fixtures stay fictional.
- Settled decisions stay settled. If you want to revisit one, flag it; don't quietly change it. No deferred-scope features (Features and Requirements, "Deferred scope") without a scope change from Earl.
- Commit as the repo's configured git user. No `Co-Authored-By` trailer. Never change git config. Never put Earl's personal email address in code, docs, commits or fixtures. Use `@example.com` for test identities.
- Stage explicit paths. Never `git add -A` or `git add .`.
- Never read, print, copy or move secrets, `.env*` files, keys or tokens. Report the path only. Use `.env.example` for names.
- Never touch cloud resources (DigitalOcean, DNS, Spaces, email or SMS providers) unless the work order and Earl's go say so.
- Before pushing: `git diff --stat origin/staging...HEAD`, to catch stale-base deletions or stray `node_modules`.
- Copy follows the design system's content rules: sentence case, **litres** and **kilograms** (never "liters"), `₦20,000.00`, `21 Oct 2026 · 10:42 AM` in Africa/Lagos time.

## Questions

Unclear product rule: check the decision notes, then the requirements. Still unclear: create a Linear issue labelled `needs:human` that asks one question and gives Option A, Option B, your recommendation and a default. Carry on with the default only if the work is reversible and not high tier. Rook (Earl's chief of staff in Cowork) copies these into Earl's open-questions register.
