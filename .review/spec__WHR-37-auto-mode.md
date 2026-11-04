---
branch: spec/WHR-37-auto-mode
linear: WHR-37
tier: high
reviewed_head: faba3ecaa671fb8e18e49e20a9c777bb8d0234aa
rounds: 2
builder: platform-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 7
invariants: []
p1: []
tickets: []
plan:
  goal: enable the approved noninteractive project policy with explicit command rules and preserved guards
  files: .codex/config.toml, .codex/rules/default.rules, docs/agentic/setup.md
  approach: keep workspace-write, set never approvals, allow only named prefixes, forbid named administrative tools, document restart and failure behavior
  tests: installed codex execpolicy checks for git commit, gh api and docker compose; guard and review self-tests; TOML parse and diff checks
  risks: allow rules execute outside sandbox; hooks and branch protections remain required; managed policies may override project defaults
---

All three independent reviewers passed round 2 after integrating the staging scaffold; hooks unchanged.
EM reran codex-cli 0.166.0 execpolicy checks: git commit allow, gh api forbidden,
docker compose allow. These evaluate rules without executing sample commands.
Guard self-test: 63 passed, 0 failed. Review self-test: 37 passed, 0 failed.
TOML and all four existing cache paths validated; git diff --check passed.
After scaffold integration, EM gates passed: pnpm typecheck, lint, test (1 test), build.
Project policy takes effect after pull/restart; managed overrides and initial trust still apply.
