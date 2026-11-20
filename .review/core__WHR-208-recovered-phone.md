---
branch: core/WHR-208-recovered-phone
linear: WHR-208
tier: high
reviewed_head: 7636975fa87064e1a3a07ad85e44e634b3ed7c5b
rounds: 1
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 5
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
All three reviewers passed round 1 without findings; worktree clean and head
unchanged after review. Certification rejects same-census recovery before writes;
readiness rejects legacy checks, protecting preparation and confirmation.
No schema, wire request, historical exclusion or snapshot changes.
T2 regression matches 904078f byte-for-byte (blob b7eb672702b371b6522f2a648004346285a2cfbe).
Both HTTP regressions failed on the baseline with expected 409 / actual 201;
both pass with the fix. Eight new PostgreSQL tests independently pass with
rolsuper=false and rolbypassrls=false, including three concurrency scenarios.
Shared records are excluded from this feature PR.
