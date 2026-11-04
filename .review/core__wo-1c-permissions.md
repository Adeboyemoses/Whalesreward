---
branch: core/wo-1c-permissions
linear: WHR-44
tier: high
reviewed_head: d03fa0cff391075c746a7a7ea08e895f3e044bbd
rounds: 2
builder: platform-engineer
reviewers:
  code-reviewer: PASS (round 2)
  security-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 8
plan:
  goal: land Earl's local git-permissions hotfix without additional permission expansion
  files: .codex/rules/default.rules, .codex/hooks/{guard,test-guard}.sh, AGENTS.md, docs/agentic/lanes/core.md, STATUS.md
  approach: preserve exact local rules; add Git guidance; normalize global Git options in guard checks to retain staging, identity and main protections
  tests: policy probes; synthetic global-option guard regressions for forbidden and valid commands; guard and review self-tests; app gates
  risks: broad git and cd prefixes require existing guard and branch protection; main checkout hotfix remains for Earl to reconcile after merge
invariants: []
p1: [fixed qualified Git commands bypassing existing guard checks]
tickets: []
---
Earl explicitly approved WHR-44 and directed committing the local hotfix.
The rules file is byte-for-byte identical to his main checkout, which remains untouched.
Round 1 found SEC-HIGH/P1: new broad Git allow exposed global-option guard gaps.
The revised plan was committed before fix dispatch; round 2 passes the guard fix.
Synthetic regression RED: 72 passed, 14 failed; final guard on Bash 3.2: 94 passed.
EM typecheck, lint, unit 18, build and review self-tests 37 passed.
Policy probes: git-C commit and gh repo view allow; gh api forbidden.
Literal CLI bash-wrapper probe is unmatched; cd and git constituents each allow.
No blanket shell permission or interpreter dependency was added.
Ambiguous quoted qualified config reads are conservatively rejected.
No product invariant or board row changed; no open findings.
