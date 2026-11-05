# lane:app
WO-app-3 (WHR-7) Uploads, retries and synced receipt: BUILD; PR #35 awaits review-cap exception, 2026-11-05
WO-app-2 (WHR-5) Offline capture: READY; Earl's phone smoke pending

## In flight
- PR #35 preserves the concurrent PR #34 closeout after resolving shared-doc conflicts. Application code is unchanged from the three PASS reviews; changed docs require re-review. Earl has been asked for one extra round; no approval or exception recorded yet.
- app/wo-3-uploads: typed M1 submit/permission/PUT/finalize/status, durable leases and backoff, original/photo retention, authoritative receipts and holds, pending uploads and cancellable upload-first sign-out.
- EM checks: typecheck/lint/build, 107 unit tests, 66 browser passes plus two unchanged targeted rerun passes (4 existing skips; WHR-60 tracks timing flakes), 3 time tests per timezone. Independent five-board fidelity at 390/360 px; ten screenshots.
- Four first-round P1s fixed: storage403 versus session denial, backoff reset, delayed logout after cancellation, hidden cancellation reason. Second-round photo-rejection refresh fix retains Needs attention. Final code/security/integrity evidence: .review/app__wo-3-uploads.md.
- WO-app-0 accepted closeout PR #31 merged; WO-app-1 accepted closeout #24 merged. WHR-5 remains READY.

## Next
- Await Earl’s answer: recommend one extra review round for documentation reconciliation; default leave PR #35 unmerged. Then STOP at READY after green staging merge. Earl uses docs/qa/smoke-2026-11-05-upload-sync.md when WO-core-4 supplies real upload endpoints.
- Keep WHR-5 READY pending Earl's phone smoke. No next work order started.

## Earl's gos
- 2026-11-05: “approve WHR-7”.
- 2026-11-05: “Build against docs/engineering/contracts/m1.md behind the existing typed adapter, with a contract-shaped fake; WO-core-4 provides the real endpoints. Never show "Synced" or credit from a client-side flag. Take it to READY, then stop.”
- 2026-11-05: “WO-app-2 (WHR-5) stays READY until Earl's phone smoke.”

## Risks
- Real storage validation/credit and physical Android acceptance remain pending. Contract fixtures do not prove server enforcement, camera readability, eviction or TalkBack.
- WHR-45 quantity trailing-zero presentation remains unchanged. No auto deletion or browser-storage backup claim.
- Dispatch flag: 16 exceeds the high-tier flag of 8 (three builders, targeted fixes and three independent review rounds).

dispatches=16 prs=1 rounds_max=3 escalations=1 model=unknown
