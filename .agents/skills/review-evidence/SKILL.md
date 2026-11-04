---
name: review-evidence
description: "Use when a Whales Rewards branch is ready for review: compute the tier, dispatch the reviewers diff-scoped, run fix rounds within the cap, and write and validate .review/<branch>.md before opening the PR."
---

# Review and evidence

1. `git diff --stat origin/staging...<branch>`: check for stray files, `node_modules`, stale-base deletions.
2. `bash scripts/review/required-reviewers.sh origin/staging...<branch>` → tier, reviewers, round cap. You may raise the tier; never lower it.
3. Re-run the gates yourself in the builder's worktree and keep the last lines of output.
4. Dispatch the required reviewers in parallel (at most three subagents), each with: branch, base `origin/staging`, head SHA, the issue, the plan (high tier), the invariant IDs, the worktree path, and "read-only, diff-scoped". If subagents aren't available, open a fresh Codex thread per reviewer with its `.codex/agents/<name>.toml` instructions; never review in the builder's thread.
5. Reviewers are read-only by instruction only (Codex subagents inherit the session sandbox). After each round, check `git -C <worktree> status --porcelain` is empty and the head SHA is unchanged; if a reviewer changed anything, discard its verdict and re-run it. Collect each `REVIEW-VERDICT`. Blocking findings go back to the builder with file:line. Count every call in `dispatches`. Stop at the round cap (low 2, medium 2, high 3) and give Earl an A/B with a default.
6. Write `.review/<branch with / as __>.md` per `.review/README.md`: `reviewed_head` = the code commit the reviewers last saw; reviewers each `PASS`; blocking all 0; P1s fixed or ticketed; MED/LOW/P2 in one batch issue under `tickets:`; at most 40 lines of prose summarising findings and fixes.
7. Commit the evidence file alone (`git add .review/<file>`), then:
   `bash scripts/review/validate-evidence.sh --base origin/staging --head HEAD --branch <branch>` must print PASS.
8. Push and open the PR into `staging` with the template. Body: `Part of WHR-<work order>`.
9. Merge when CI and `review-evidence` are green: `gh pr merge <n> --squash --match-head-commit <sha>`. Then confirm `git log origin/staging..<branch>` is empty and check the work order's state.
