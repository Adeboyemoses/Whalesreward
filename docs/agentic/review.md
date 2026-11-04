# Risk tiers, review and evidence

The tier decides who reviews a PR and how many fix rounds it gets. The routing lives in one place, `scripts/review/routing.conf`, read by `scripts/review/required-reviewers.sh`. The `review-evidence` CI check and the EM both use that script, so they can't disagree.

## Tiers

| | Low | Medium | High |
|---|---|---|---|
| Typical diff | Presentational UI (`src/ui/**`, `src/styles/**`), copy, tests only | New or changed non-auth endpoint, a page wired to the API, card batches, prices and settings, reports and leaderboard queries, additive migration, shared contracts | See the high list below |
| Reviewers | code-reviewer | code-reviewer + the domain reviewer(s) the routing names (default security-reviewer) | code-reviewer + security-reviewer + integrity-reviewer |
| Round cap | 2 (review, then one fix check) | 2 | 3 |
| Dispatch flag | > 4 | > 4 | > 8 |
| Blocks merge | P0, SEC-HIGH | P0, SEC-HIGH | P0, SEC-HIGH, INTEGRITY-P1 |

**High** means any of:

- Sign-in, sessions, passwords, first-password change, email verification and reset tokens, roles, permissions, delegation, last-Owner protection.
- Purchase acceptance and credit, idempotency, revisions and corrections, midnight cutoff, duplicates, price, card and date holds and their resolutions, queue recovery, giveaway finalization and revisions.
- The offline client: Dexie schema and migrations, the outbox, the 24-hour window, account partitioning, the service worker and what it caches, camera capture.
- Sync and finalize endpoints, signed upload permissions, photo validation and the final evidence path.
- Money, quantity and time helpers (`src/shared/money*`, `src/shared/quantity*`, `src/server/lib/time*`).
- A destructive or backfilling migration (DROP, TRUNCATE, DELETE, type change, rename).
- Retention, deletion and backup jobs.
- Enforcement and agent files: `AGENTS.md`, `.codex/**`, `.agents/**`, `scripts/review/**`, `.github/**`, `docs/agentic/soul.md`, `.review/README.md`.

Docs-only PRs (`*.md` outside the enforcement list) need no evidence file.

## Severity

| Label | Means | Merge |
|---|---|---|
| P0 | Data loss, a crash on a main flow, or a broken build | Blocks |
| SEC-HIGH | An attacker or an ordinary user could read or change what they shouldn't | Blocks |
| INTEGRITY-P1 | A sale could be credited twice, lost, credited without evidence, miscounted, or ranked wrongly; history could be rewritten; another account's queue could leak | Blocks at high tier; never deferred |
| P1 | A real bug in the acceptance path | Fix it, or open a Linear issue and list its ID under `p1:` |
| P2 / MED / LOW | Worth fixing, not now | One batch issue, listed under `tickets:` |

At the round cap with a blocker still open, the EM gives Earl an A/B with a default. A further miss parks the branch.

## How reviewers run

- Dispatch the tier's reviewers in parallel. Each gets the branch, the base, the issue, the plan (high tier) and the invariant IDs in play.
- Reviewers are read-only and diff-scoped (by instruction; subagents inherit the session sandbox, so the EM checks the worktree is clean and the head unchanged after each review): `git diff origin/staging...<branch>`, `git show <branch>:<path>`, `rg`, and running tests inside the worktree path the EM names. They never `checkout`, `switch`, `stash`, `reset`, edit or commit.
- Each reviewer ends with a `REVIEW-VERDICT` block:

```
REVIEW-VERDICT
reviewer: integrity-reviewer
branch: core/WHR-21-accept-purchase
head: 1a2b3c4
result: PASS | FAIL
findings:
  - [INTEGRITY-P1] src/server/modules/purchases/accept.ts:88 — retry after a lost response credits again; claim the row with updateMany on (account_id, operation_id, status) and check count
blocking: {P0: 0, SEC-HIGH: 0, INTEGRITY-P1: 1}
```

- Findings below 80% confidence are dropped. Pre-existing issues the diff doesn't touch, lint-level style and taste are out of scope.

## Evidence

One file per PR branch, committed in the PR: `.review/<branch, with / replaced by __>.md`. Format and rules: [.review/README.md](../../.review/README.md). `scripts/review/validate-evidence.sh` checks it locally and in CI.

## Promotion to `main`

- The EM opens the `staging` → `main` PR with a checklist: PRs included, migrations, environment variables added, data steps, known limits.
- It merges only after Earl's go in the current session naming the PR number, running the merge as `WHR_MAIN_GO=<YYYY-MM-DD> gh pr merge <n> --merge --match-head-commit <sha>`, and recording Earl's words and the PR in the lane file. By default Earl merges promotion PRs himself in GitHub; the EM merges one only when Earl tells it to in the session.
- Promotion PRs carry no evidence file; their content was reviewed on the way into `staging`.
