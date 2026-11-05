# lane:core
WO-core-4 (WHR-6) sync and evidence: READY on reviewed green staging merge and verification handoff, 5 November 2026

## In flight
- Implementation PR and pasted final EM output are linked on WHR-6. High-tier plan/evidence: .review/core__wo-4-sync.md. READY takes effect only after independent code/security/integrity PASS and all CI gates green; then move WHR-6 In Review and stop.
- M1 lookup, durable originals/receipt, bounded private upload, immutable validated final evidence and atomic accepted revision/audit. P-18 has one server policy module with exact PostgreSQL microsecond comparisons.
- Named real PostgreSQL/MinIO tests cover lost response, concurrent finalize, adversarial staging overwrite and mixed uncertainty. Chromium Blob test verifies signed byte length with Content-Type-only CORS. Full verification counts/output belong to WHR-6.
- Round1 fixes: signed upload size, exact P-18 timestamps, finalize-key scope and bounded captured-rate validation. Independent regressions reproduced failures first.
- WHR-28 FIX and WHR-53 ACCEPTED/Done through green closeout #34 (7b0c3ab). WHR-59 resolved from existing M3 text: durable policy blocks separate from holds, M1 policy_review_required.

## Next
- STOP at READY; no next work order.
- Earl's live Spaces/phone smoke: docs/qa/smoke-2026-11-05-core-sync.md; upload UI remains WO-app-3. No cloud-resource or staging-data changes performed.

## Earl's gos
- 2026-11-05: “Earl accepted the WHR-28 FIX and WO-core-1d (WHR-53); close both.”
- 2026-11-05: “Take it to READY with the named tests' output pasted, then stop.”

## Risks
- Actual authenticated Spaces PUT/finalize is not claimed by MinIO/signing/browser tests. WHR-58 remains separate. P-18/Q-528 is still the approved build default; uncertain intervals retain zero credit.
- Core sync dispatch flag:10>8, including independent regressions and second-round reviews. Two rounds remain within cap3. Session total includes closeout reviewer; runtime model ID unavailable.

dispatches=11 prs=2 rounds_max=2 escalations=0 model=unavailable
