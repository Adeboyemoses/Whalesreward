# lane:core
WO-core-2 (WHR-3) Core schema and exact helpers: BUILD since 2026-11-04

## In flight
- Implements merged data-model spec PR #4 (7d92cb6); lane holds lock:schema.
- Backend builders: schema/SQL/seed and arithmetic/time/IDs/logger in separate worktrees; test-engineer checks the database contract.
- High-tier plan committed before dispatch. No endpoints, auth wiring or UI.

## Next
- Integrate builder commits, EM gates, then independent code/security/integrity review and staging PR.
- WHR-41 is unfinished: preserved plan eafac6d and uncommitted regression tests in .worktrees/core-1b-evidence; Earl redirected to WHR-3.

## Earl's gos
- 2026-11-04: "Accepted. Scaffold verified." — WHR-1 closed Done after PR #8 merged.
- 2026-11-04: "Work order: WO-core-2 (WHR-3). Implement docs/engineering/data-model.md. Follow AGENTS.md."

## Risks
- Open capture-time/campaign/auth policy stays unresolved; this work adds schema foundations only.
- No staging or production cloud environment provisioned.
- Session model below is the model named in WHR-3 (reasoning high).

dispatches=3 prs=0 rounds_max=0 escalations=0 model=gpt-6-astra
