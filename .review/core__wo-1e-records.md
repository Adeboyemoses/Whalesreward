---
branch: core/wo-1e-records
linear: WHR-63
tier: high
reviewed_head: fb89494298957ceadf350670230119b8b30227b7
rounds: 2
builder: platform-engineer
reviewers:
  code-reviewer: PASS (round 2)
  security-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 8
p1: ["fixed docs-only exemption outside protected record changes"]
tickets: []
plan:
  goal: Reject shared record changes in feature PRs while allowing separate docs-only READY and close records PRs.
  files: AGENTS.md, docs/agentic/work-orders.md, .agents/skills/close-session/SKILL.md, .agents/skills/review-evidence/SKILL.md, scripts/review/validate-evidence.sh, scripts/review/test-review.sh.
  approach: State the approved rule once in each required instruction file, remove contradictory bundling guidance, and reject prohibited paths in the PR diff when evidence declares a non-docs tier without altering existing review checks.
  tests: Add RED then GREEN cases for STATUS.md, coverage-map.md and lane Markdown files; docs-only records pass; review and guard self-tests plus EM typecheck, lint, unit and build gates.
  risks: Do not reject records-only PRs or unrelated base merges; preserve reviewed-head ancestry, unchanged-plan and round-cap enforcement, and Bash 3.2 compatibility.
invariants: []
---

Approved WHR-63 only. This feature PR excludes STATUS.md, docs/engineering/coverage-map.md and docs/agentic/lanes/*.md; READY records follow after merge in a separate docs-only PR.

Non-docs evidence plus a protected shared-record diff now fails with a path-specific message. Docs-only records remain allowed without feature evidence; unrelated staging record changes do not count as PR edits. Removal and rename paths are checked too. The approved rule appears in each of the four required instruction files; contradictory bundling guidance is removed.

Round 1 code review found that docs-only PRs without protected changes had inadvertently gained full evidence validation. The builder narrowed that behavior and added a paired incomplete-evidence README/STATUS regression. All three reviewers passed round 2 with no remaining findings. EM verified the worktree was clean and head unchanged after each round.

RED: six intended failures for the new rule; follow-up RED: one exemption failure. GREEN: review self-tests 53/53 and guard self-tests 94/94. EM typecheck, lint, unit108 and build passed; final-head checks and CI are pasted in the PR. No application code, product invariant, migration or user flow changes.

```text
REVIEW-VERDICT
reviewer: code-reviewer
branch: core/wo-1e-records
head: fb89494298957ceadf350670230119b8b30227b7
result: PASS
findings: []
blocking: {P0: 0, SEC-HIGH: 0, INTEGRITY-P1: 0}

REVIEW-VERDICT
reviewer: security-reviewer
branch: core/wo-1e-records
head: fb89494298957ceadf350670230119b8b30227b7
result: PASS
findings: []
blocking: {P0: 0, SEC-HIGH: 0, INTEGRITY-P1: 0}

REVIEW-VERDICT
reviewer: integrity-reviewer
branch: core/wo-1e-records
head: fb89494298957ceadf350670230119b8b30227b7
result: PASS
findings: []
blocking: {P0: 0, SEC-HIGH: 0, INTEGRITY-P1: 0}
```
