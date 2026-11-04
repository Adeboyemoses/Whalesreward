# Review evidence

One file per PR branch, **committed in the PR**: `.review/<branch>.md`, with every `/` in the branch name replaced by `__` (`core/WHR-21-accept-purchase` → `.review/core__WHR-21-accept-purchase.md`). Git history is the archive; nothing is moved or deleted after merge. Tiers and routing: [docs/agentic/review.md](../docs/agentic/review.md). This README is itself enforcement (high tier).

## Format

YAML front matter between the first two `---` lines, then **at most 40 lines** of prose: what changed, what the reviewers found, how each finding was resolved.

```yaml
---
branch: core/WHR-21-accept-purchase   # must equal the PR head branch
linear: WHR-21
tier: high                            # low | medium | high; may be higher than computed, never lower
reviewed_head: 1a2b3c4                # SHA the reviewers last saw (7-40 hex)
rounds: 2                             # cap: low 2, medium 2, high 3
builder: backend-engineer             # must not appear under reviewers
reviewers:                            # every required reviewer, each exactly PASS (optional " (note)")
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}   # all must be 0
dispatches: 5
plan:                                 # high tier only; committed before the builder is dispatched
  goal: accept an uploaded sale and credit it exactly once
  files: src/server/modules/purchases/**, prisma/migrations/**
  approach: claim the pending row with updateMany on status, write revision + audit in one transaction
  tests: lost-response retry, same-ID-different-content conflict, concurrent finalize
  risks: additive migration adds a unique index on (account_id, operation_id)
invariants: [I-22, I-26, I-28]        # invariants this PR implements or touches
p1: []                                # each a Linear ID or "fixed <how>"
tickets: [WHR-40]                     # batch issue for P2/MED/LOW
# escalation: Earl chose B on 2026-11-20 (ship + WHR-44)   # only when rounds exceed the cap
---
```

## Rules the validator checks

- Required keys: `branch`, `tier`, `reviewed_head`, `rounds`, `builder`, `reviewers`, `blocking`, `dispatches`.
- `branch` equals the PR head branch. `tier` is at least the tier `required-reviewers.sh` computes.
- Every required reviewer is listed with `PASS`. `PASS, but …` is not a pass. The builder is not a reviewer.
- Every `blocking` count is `0`. High tier must include `INTEGRITY-P1-OPEN`.
- `rounds` is within the cap, or `escalation:` records Earl's decision with a `YYYY-MM-DD` date.
- High tier: `plan:` has `goal`, `files`, `approach`, `tests` and `risks`, and the plan block is identical at `reviewed_head` (commit it before dispatch; it can't be added after review).
- `reviewed_head` is an ancestor of the PR head, and the commits after it touch only `.review/*.md`. Any other change after review means review again.

## Writing it

1. High tier: commit this file with `plan:` before dispatching the builder.
2. After the last review round, set `reviewed_head` to the reviewed code commit and fill in the rest.
3. Commit the evidence file on its own. Run `bash scripts/review/validate-evidence.sh --base origin/staging --head HEAD --branch "$(git branch --show-current)"` before pushing.
