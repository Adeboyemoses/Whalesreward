---
name: close-session
description: "Use at the end of every Whales Rewards session, or when a work order reaches READY, to post the READY or close message and update the lane file, STATUS.md and the coverage map."
---

# Close a session

1. **State.** Decide the work order's state: BUILD (stopping mid-way), READY, FIX or ACCEPTED (docs/agentic/work-orders.md#states).
2. **READY message** (when "Done means" is met): one plain headline; PR links; the smoke runbook path (user-facing) or pasted verification output (back-end); decisions needed as Option A / Option B / Recommend / Default by <date>. Then stop and wait.
3. **Coverage map.** Update `docs/engineering/coverage-map.md` for every invariant and board row this session touched: work order, test name or parity report, status.
4. **Lane file.** Overwrite `docs/agentic/lanes/<lane>.md` in the format of `docs/agentic/lanes/README.md` (3 KB max), ending with `dispatches=N prs=M rounds_max=R escalations=E model=<full model ID>`. Flag any PR over its dispatch flag (4 low/medium, 8 high).
5. **STATUS.md** at the repo root (Rook reads it): update the date, milestone, done this week, in progress, blocked / decisions needed, next up, known risks.
6. **Linear.** Comment the summary on the work order; move it to In Review (READY) or Done (ACCEPTED, after the close-out PR merges). Found work is filed as `found-in:<WO>` issues.
7. **Commit from a worktree**, never the main checkout. Bundle these docs with the last code PR when possible; otherwise a docs-only PR.
8. **Clean up** merged worktrees: `git worktree remove .worktrees/<slug>` (only after the branch merged).
