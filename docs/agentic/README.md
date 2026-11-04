# The agentic development model

How Whales Rewards gets built: who does what, how a session runs, and how work moves from a Linear work order to `main`. It is the Phaneum model, slimmed down for a five-to-six-week, one-station client MVP, and written for Codex.

```
Earl (CEO, approves work orders and every T2 action)
  │
Rook (Cowork chief of staff: drafts work orders, reads STATUS.md, keeps the open-questions register)
  │   Linear team WHR (work orders)           product-docs/ (what to build)
  ▼
Codex session = Engineering Manager, one lane, one work order
  ├── builders (write code, each in its own worktree)
  │     backend-engineer · platform-engineer · offline-engineer · frontend-engineer · test-engineer
  └── reviewers (read-only, diff-scoped, never the builder)
        code-reviewer · security-reviewer · integrity-reviewer
```

## Roles

| Role | Where it lives | Writes | Model effort |
|---|---|---|---|
| Engineering manager | The main Codex thread; rules in AGENTS.md and below | Plans, evidence, PRs, lane file, STATUS.md, small fixes | Earl picks the model per session |
| backend-engineer | `.codex/agents/backend-engineer.toml` | `prisma/**`, `src/server/**`, `src/app/api/**`, `jobs/**` | medium |
| platform-engineer | `.codex/agents/platform-engineer.toml` | `.github/**`, `.do/**`, `docker-compose.yml`, `scripts/**`, tooling config, `.codex/**` (with Earl's go) | medium |
| offline-engineer | `.codex/agents/offline-engineer.toml` | `src/client/offline/**`, `src/client/sw/**`, PWA manifest, camera and photo code | high |
| frontend-engineer | `.codex/agents/frontend-engineer.toml` | `src/app/(attendant)/**`, `src/app/(admin)/**`, `src/ui/**`, `src/styles/**`, implementation briefs | medium |
| test-engineer | `.codex/agents/test-engineer.toml` | `tests/**`, `*.test.ts`, Playwright specs, design-parity screenshots | medium |
| code-reviewer | `.codex/agents/code-reviewer.toml` | Nothing (REVIEW-VERDICT only) | high |
| security-reviewer | `.codex/agents/security-reviewer.toml` | Nothing | high |
| integrity-reviewer | `.codex/agents/integrity-reviewer.toml` | Nothing | high |

Builders never review. Reviewers never edit. A PR's evidence must list at least one reviewer who is not its builder (maker ≠ checker).

## The engineering manager

Every Codex session is the EM for one lane. Its lifecycle:

1. **Open.** Read AGENTS.md's start list. Open the work order named in the prompt with the `start-work-order` skill. Check it carries Earl's approval line. Its children are your whole scope.
2. **Batch the questions.** Read the inputs the work order lists (decision notes, boards, F&R sections). Put every open question to Earl in one message at the start, each with a default and a date. Log them in Linear as `needs:human`.
3. **Tier and plan.** For each child, run `scripts/review/required-reviewers.sh` on the paths you expect to touch and set `risk:low|med|high` on the issue. High tier: write and commit the `plan:` block in the evidence file **before** dispatching the builder.
4. **Brief and dispatch.** UI work a hi-fi board covers needs an implementation brief first (`implementation-brief` skill). Give the builder: the issue, acceptance, the paths it may touch, the board IDs, the invariants it must keep, the tests to write and the gates to run. Each builder gets its own worktree: `git worktree add .worktrees/<slug> -b <lane>/WHR-<n>-<slug> origin/staging`. Run at most three subagents at once.
5. **Verify.** Re-run the gates yourself in the builder's worktree. Read the diff. A builder's "all green" is a claim, not a fact.
6. **Review.** Dispatch the tier's reviewers in parallel, read-only, diff-scoped (`git diff origin/staging...<branch>`). Fix rounds stay within the cap. At the cap, give Earl an A/B with a default.
7. **Evidence and PR.** Write `.review/<branch>.md` (`review-evidence` skill). Open a PR into `staging` whose body says `Part of WHR-<work order>`, never a closing word for the work order itself (a child issue may be closed with `Fixes WHR-<child>`). Merge with `gh pr merge <n> --squash --match-head-commit <sha>` once CI and `review-evidence` are green.
8. **Ready.** When the work order's "Done means" is met, post the READY message (format below) and stop. User-facing work stops at "ready for Earl's smoke test" with a runbook; back-end work stops at "agent-verified" with pasted test output.
9. **Close.** On Earl's acceptance: overwrite the lane file, update `STATUS.md` and the coverage map (`close-session` skill), and mark the work order Done.

The EM may write code only for fixes of about 10 lines, docs, git operations and triage. Anything bigger is a builder's job, even when it would be faster to do it yourself. That separation is what makes review meaningful.

## Lanes

Two lanes, so two Codex sessions can run in parallel without colliding.

- **`lane:core`**: the server. Prisma schema and migrations (it alone holds `lock:schema`), domain services, route handlers, sync and finalize endpoints, auth, jobs, CI and deployment.
- **`lane:app`**: what people touch. Attendant PWA screens, admin portal screens, the offline client (Dexie outbox, service worker, camera), UI components and styles.

A contract between the lanes (a route handler and its client call) is defined in `src/shared/contracts/**` (zod schemas and types). Either lane may propose a change there, but the PR that changes a contract must update both sides or open a child issue in the other lane. `src/shared/**` changes are reviewed as medium tier at least.

## Rook and Earl

- **Rook** drafts work orders in Linear from the [roadmap](../engineering/roadmap.md), with goal, scope, inputs, "Done means" and verification. When Earl approves, Rook adds the approval line and moves the work order to Todo.
- **Earl** starts each Codex session with a prompt like: `You are the EM for lane:core. Work order WHR-12.` He gives every T2 go himself, in the session.
- **Codex** never messages Rook directly. It writes `STATUS.md` and the lane file at every close, and `needs:human` issues for questions. Rook reads them when Earl grants folder access in Cowork, and copies decisions into Earl's Cowork records.

## Messages to Earl

- Lead with where things stand, in one plain sentence. Translate every ID the first time you use it ("price review (WHR-31)"). **Bold** what he must act on.
- One bullet, one fact. Outcomes, not activity. No raw logs.
- Each decision gives: Option A, Option B, your recommendation with a one-line reason, and the default if he hasn't replied by a stated date.
- Never end on an open question without a default. If nothing is needed, say "No decisions needed today."

## Skills (`.agents/skills/`)

| Skill | Use it to |
|---|---|
| `start-work-order` | Open and check a work order, batch questions, tier the children, create worktrees |
| `implementation-brief` | Turn hi-fi boards and decision notes into a build brief before UI dispatch |
| `review-evidence` | Compute the tier, run reviewers, write `.review/<branch>.md` |
| `design-fidelity-check` | Compare built screens to the hi-fi PNGs at section sign-off (run by test-engineer) |
| `log-decision` | Record a settled technical or product decision in `docs/engineering/decisions/` |
| `close-session` | Write the lane file, STATUS.md and coverage-map rows; post the READY or close message |
