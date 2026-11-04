# lane:app
WO-app-1 (WHR-2) Design system and app shells: ACCEPTED since 2026-11-04
WO-app-2 (WHR-5) Offline capture: BUILD since 2026-11-04

## In flight
- Closing accepted WO-app-1. Foundation PR #12 and wrap FIX PR #20 merged; component/phone-width parity reports in docs/qa/.
- WO-app-2: precommitted high-tier plan and smoke runbook; offline and frontend builders own isolated worktrees. Real endpoints belong to WO-core-3.

## Next
- WO-app-2 automated offline restart/account-isolation tests, independent fidelity and code/security/integrity review, then green staging merge and READY.
- Stop at READY; Earl’s phone smoke waits for WO-core-3 merge.

## Earl's gos
- 2026-11-04: “Earl accepted WO-app-1 (WHR-2); close it.”
- 2026-11-04: “Work order: WO-app-2 (WHR-5), offline capture.” Build against M1 typed client adapter with a contract-shaped fake for tests; “Take it to READY with Playwright green, then stop”.

## Risks
- WO-app-2 is not yet verified; phone acceptance is deferred, not implied by browser tests.
- WHR-45 remains separately tracked; no new scope added.

dispatches=2 prs=1 rounds_max=0 escalations=0 model=unknown
