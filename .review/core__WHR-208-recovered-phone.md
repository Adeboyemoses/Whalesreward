---
branch: core/WHR-208-recovered-phone
linear: WHR-208
tier: high
reviewed_head: pending
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Enforce M4 P-30 recovered-phone replacement census before empty certification.
  files: src/server/modules/giveaway/**, tests/integration/giveaway*, tests/e2e/giveaway*, docs/qa/smoke-2026-11-20-recovered-phone.md
  approach: Under existing locks reject empty checks for phones approved unavailable under the same census; revalidate the rule in readiness and preparation without changing requests or immutable history.
  tests: Unchanged T2 regression 904078f; real HTTP old-census refusal with no effects and replacement-census success; non-superuser PostgreSQL concurrent approval/check/census/preparation tests; full required gates.
  risks: Legacy invalid checks must fail closed; concurrent transitions must serialize; old exclusions and snapshots must remain immutable; strict wire requests remain unchanged.
invariants: [I-07, I-41, I-46]
p1: []
tickets: []
---
Commissioned by Earl on 20 Nov 2026 in WHR-208 and this session.
Review focus: empty certification bypass, legacy checks in readiness/preparation,
concurrent approval and checks, replacement census identity, immutable history.
