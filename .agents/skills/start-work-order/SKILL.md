---
name: start-work-order
description: "Use at the start of every Whales Rewards session to open the work order named in the prompt, check Earl's approval, batch questions, tier the children and set up worktrees. Not for picking work when no work order is named."
---

# Start a work order

1. **Identify.** The prompt names a lane and a work order (`WO-core-3` or `WHR-<n>`). If either is missing, ask Earl and stop.
2. **Check approval** in Linear (team `WHR`): the description's last line starts `Approved by Earl, ` and the state is Todo (start) or In Progress / In Review (resume). Otherwise ask Earl; never edit the approval line or move the work order to Todo yourself. Full rules: docs/agentic/work-orders.md#approval.
3. **Read** AGENTS.md's start list, your lane file, and every input the work order lists (board IDs → `product-docs/04 UI Design/Hi-Fi/`, decision notes, F&R and TRD sections, invariant IDs). Make sure `product-docs/` resolves: `ls product-docs/` (in a worktree, `bash scripts/link-product-docs.sh`).
4. **Comment** `started: lane:<lane> session <YYYY-MM-DD>` on the work order and move it to In Progress.
5. **Questions in one batch.** List every ambiguity you found. For each: Option A, Option B, your recommendation, the default and the date it applies. Post them to Earl in one message and create one `needs:human` issue per question in team `WHR`, linked to the work order. Continue with defaults only for reversible, non-high-tier work.
6. **Tier each child.** `bash scripts/review/required-reviewers.sh --files <paths you expect to touch>`; add `risk:low|med|high` to the issue (raise it if your judgement says so, never lower).
7. **Smoke runbook first** (user-facing work orders): write `docs/qa/smoke-<date>-<slug>.md` now.
8. **Worktrees.** `git fetch origin && git worktree add .worktrees/<slug> -b <lane>/WHR-<n>-<slug> origin/staging`, then inside it `pnpm install --frozen-lockfile` and `bash scripts/link-product-docs.sh`.
9. **High-tier children:** inside that worktree, write `.review/<branch with / as __>.md` with the `plan:` block (goal, files, approach, tests, risks) and commit it on the branch before dispatching anyone.
10. **Brief UI work** with the `implementation-brief` skill before dispatching frontend-engineer.
11. Post a one-paragraph plan to Earl: children, tiers, order, what runs in parallel (at most three subagents), and when you expect READY.
