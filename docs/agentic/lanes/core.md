# lane:core
WO-core-6 (WHR-10) M2 pumps, prices and attendants backend: READY since 2026-11-06

## In flight
- Feature [#68](https://github.com/Adeboyemoses/Whalesreward/pull/68) merged into staging at c6390ec with all five required checks green. M2 APIs cover pump creation, immediate immutable product price/precision, attendant provisioning, first password, assignment/history and configured-versus-acknowledged handover.
- Code/security/integrity PASS round 2 at 3995e55; high-tier evidence validates. Paused-COMMIT price-history false credit fixed with shared/exclusive product locks; credential compatibility and bounded cursor regressions fixed.
- EM exact-source checks: typecheck/lint/build, unit248, PostgreSQL178, named27, time3 per timezone, Linux browser104/four existing staging-only skips/zero retries, signed-upload1 PASS. Named output: docs/qa/verification-2026-11-06-station.md.
- WHR-73/68 already accepted and Done via closeout #66 (19ffeef); WHR-9 records Earl's successful real verification/reset smoke. No duplicate closure.

## Next
- Stop at M2 backend READY; WHR-10 stays In Review awaiting Earl's verification. Full acceptance still needs WHR-76 scope resolution and WHR-77 first-password UI; WO-app-5 supplies price/assignment screen smoke. No next work order started.

## Earl's gos
- 2026-11-06: “Work order: WO-core-6 (WHR-10), pumps, prices, attendants and assignment, against docs/engineering/contracts/m2.md. Include the P-20 regression tests. Take it to READY with named test output, then stop.”

## Risks
- WHR-76: M2/settled notes exclude pump edit/deactivation and attendant status/reset, despite broader WO wording. No disputed endpoint or scope extension added; no silence treated as approval.
- WHR-77 (high): current attendant UI parses only ready sessions; new-account first-password UI must land before end-to-end use. Backend completion requires fresh sign-in and never issues an early capture context.
- WHR-78: one reviewer parallel fixture-extension setup collision; serial rerun and unchanged EM parallel178/27 passed. No gate, limiter, time rule or policy relaxed.
- No cloud/provider or manual staging-data operation; no UI parity or full work-order acceptance. P-20 client Q-528 remains pending.
- Dispatch flag: feature #68 used9 >8 dispatches; two rounds within cap3. Two separate records-review dispatches make11 total. Runtime model ID unavailable.

dispatches=11 prs=2 rounds_max=2 escalations=0 model=unavailable
