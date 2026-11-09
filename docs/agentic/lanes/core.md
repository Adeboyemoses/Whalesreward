# lane:core
WO-core-6a (WHR-80) P-21 attendant offboarding: READY since 2026-11-09

## In flight
- Feature [#77](https://github.com/Adeboyemoses/Whalesreward/pull/77) merged into staging at 72a737b with all five required checks green. Guarded assignment ending revokes full/restricted sessions and contexts atomically, retaining history, queued originals and P-20 bounds.
- Code/security/integrity PASS round 2 at8739cbb; high-tier evidence validates. EM typecheck/lint/build, unit260, PostgreSQL201/named23, time3 per timezone, exact-source Linux browser130/four existing staging-only skips/zero retries and signed-upload1 PASS. Named output: docs/qa/verification-2026-11-09-offboarding.md.
- Actual audit/rollback, OR permissions, exact guards, revocation races, historical replay after reassignment, old-key401/fresh-unassigned422, and termination one microsecond before/at/after original U verified. Two legacy fixture setups gained current assignment/fresh authority; all original policy assertions retained.

## Next
- Post WHR-80 READY with named output; keep it In Review pending Earl's verification. Then immediately start approved WO-core-7 (WHR-12), customers, registration and card batches, in this session as Earl expressly requested. Stop after WHR-12 READY; no acceptance inferred for either.

## Earl's gos
- 2026-11-09: “Do WHR-80 first: implement P-21 offboarding per m2.md, take it to READY with named test output, post READY. Then continue straight into WHR-12 (customers, registration and card batches) and take it to READY. Stop after WHR-12's READY.”

## Risks
- P-21 adds assignment ending, no attendant disable/reset or pump deactivation. No migration/dependency or cloud/provider/manual staging-data operation; no main promotion or UI parity.
- Full M3 recovery-grant/capture-review APIs remain future work; no new authority is fabricated. Actual later same-account reassignment/upload is verified. New registration checks belong to WHR-12 and must use the same live authority protocol.
- Offline phones retain their partition and originals until observing revocation; no remote-erasure claim. Earlier revocation time and original S/R/U remain intact; client Q-528 pending.
- Feature #77 dispatch flag9>8 reflects explicit replay coverage and scoped re-review; two rounds within cap3. One separate records reviewer makes10 total. Runtime model ID unavailable.

dispatches=10 prs=2 rounds_max=2 escalations=0 model=unavailable
