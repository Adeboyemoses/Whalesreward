# lane:spec
WO-spec-2a (WHR-79) attendant offboarding by assignment end: READY since 2026-11-06

## In flight
- [Specification PR #71](https://github.com/Adeboyemoses/Whalesreward/pull/71) merged into staging at 8368f48 with all five CI checks green. P-21 records Earl's WHR-76 decision; M1/M2/M3 and the model specify guarded termination, immediate server revocation, immutable queue/history context and P-20 recovery validation.
- Code/security/integrity PASS round 2 at d392a716; the missing typed audit catalogue from round 1 is fixed. Evidence: `.review/spec__wo-2a-offboarding.md`.
- EM final head: typecheck, lint, 248 unit tests, production build and evidence validation PASS. New prose <=120 words and local links/whitespace checked. CI integration/browser/storage checks PASS. This separate records PR is linked from WHR-79.
- Specification only; no offboarding implementation or screen parity claimed. WHR-79 remains In Review awaiting Earl's reading; no acceptance or closure inferred.

## Next
- Stop at READY. Backend follow-up [WHR-80](https://linear.app/phaneum/issue/WHR-80) stays Backlog pending a separate approved core work order.
- Rook should mirror P-21 into product docs and keep attendant disable as a possible later client addition.

## Earl's gos
- 2026-11-06: “Work order: WO-spec-2a (WHR-79), attendant offboarding by ending the pump assignment, per Earl's decision on WHR-76. Take it to READY, then stop. Follow AGENTS.md.”

## Risks
- A disconnected phone cannot observe revocation instantly; it retains originals and locks on observing revocation. Unassigned leavers need scoped original-phone recovery or later authorized reassignment for upload authority; neither grants credit.
- Q-528 client confirmation remains pending. No new policy, provider or cloud action is authorized. Full runtime model ID unavailable.

dispatches=7 prs=2 rounds_max=2 escalations=0 model=unavailable
