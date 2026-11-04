# lane:core
WO-core-1c (WHR-44) Auto-mode Git permissions hotfix: READY since 2026-11-04

## In flight
- [PR #14](https://github.com/Adeboyemoses/Whalesreward/pull/14) merged into staging at de05d2d; all five required CI checks passed.
- Exact local rules copy preserved. Global-option guard bypass fixed; code/security/integrity PASS in round 2 at d03fa0c. EM typecheck, lint, unit 18, build, Bash 3.2 guard 94 and review self-tests 37 passed.
- No product invariant or board row changed; coverage map unchanged.

## Next
- Earl runs `git checkout -- .codex/rules/default.rules` then `git pull` in the main checkout, as WHR-44 prescribes. The local hotfix remains untouched by this session.
- Await Earl's hotfix verification/acceptance; no next work order started.
- WHR-4 attendant sign-in approved and queued for a separate core session. WHR-46 M3 contracts approved for lane:spec.
- WHR-41 unfinished: plan eafac6d and uncommitted regression tests preserved in .worktrees/core-1b-evidence after Earl's earlier redirect.

## Earl's gos
- 2026-11-04: "approve WHR-44, WHR-4, WHR-46"
- 2026-11-04: "WHR-44: commit the git-permissions fix you applied by hand."

## Risks
- Ambiguous qualified config commands, including quoted paths, are conservatively blocked; use a standalone command in the worktree for reads.
- Literal CLI bash-wrapper policy probe is unmatched; separate cd/git probes allow. No blanket shell permission added.
- WO-core-2 (WHR-3) remains READY pending acceptance; PR #10 dispatch flag 10 > 8, no open findings.
- Requested Session model: gpt-6.1-sol, reasoning high. Runtime model ID is not exposed; metric follows the actual-runtime rule.

dispatches=9 prs=2 rounds_max=2 escalations=0 model=unavailable
