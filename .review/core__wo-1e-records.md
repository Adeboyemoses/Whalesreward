---
branch: core/wo-1e-records
linear: WHR-63
tier: high
plan:
  goal: Reject shared record changes in feature PRs while allowing separate docs-only READY and close records PRs.
  files: AGENTS.md, docs/agentic/work-orders.md, .agents/skills/close-session/SKILL.md, .agents/skills/review-evidence/SKILL.md, scripts/review/validate-evidence.sh, scripts/review/test-review.sh.
  approach: State the approved rule once in each required instruction file, remove contradictory bundling guidance, and reject prohibited paths in the PR diff when evidence declares a non-docs tier without altering existing review checks.
  tests: Add RED then GREEN cases for STATUS.md, coverage-map.md and lane Markdown files; docs-only records pass; review and guard self-tests plus EM typecheck, lint, unit and build gates.
  risks: Do not reject records-only PRs or unrelated base merges; preserve reviewed-head ancestry, unchanged-plan and round-cap enforcement, and Bash 3.2 compatibility.
invariants: []
---

Approved WHR-63 only. This feature PR excludes STATUS.md, docs/engineering/coverage-map.md and docs/agentic/lanes/*.md; READY records follow after merge in a separate docs-only PR.
