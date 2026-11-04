---
branch: core/wo-1c-permissions
linear: WHR-44
tier: high
reviewed_head: 0000000
rounds: 0
builder: platform-engineer
reviewers:
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: land Earl's local git-permissions hotfix without additional permission expansion
  files: .codex/rules/default.rules, AGENTS.md, docs/agentic/lanes/core.md, STATUS.md
  approach: preserve exact local rules file; add standalone or cd-then-git guidance; keep guard hooks and review gate intact
  tests: execpolicy probes for git-C commit, bash cd-then-push, gh repo view and forbidden gh api; guard and review self-tests; app gates
  risks: broad git and cd prefixes require existing guard and branch protection; main checkout hotfix remains for Earl to reconcile after merge
invariants: []
p1: []
tickets: []
---
