---
branch: spec/WHR-37-auto-mode
linear: WHR-37
tier: high
plan:
  goal: enable the approved noninteractive project policy with explicit command rules and preserved guards
  files: .codex/config.toml, .codex/rules/default.rules, docs/agentic/setup.md
  approach: keep workspace-write, set never approvals, allow only named prefixes, forbid named administrative tools, document restart and failure behavior
  tests: installed codex execpolicy checks for git commit, gh api and docker compose; guard and review self-tests; TOML parse and diff checks
  risks: allow rules execute outside sandbox; hooks and branch protections remain required; managed policies may override project defaults
---
