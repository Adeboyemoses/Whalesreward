# WHR-187: round-1 fix and verification handoff

Resume authorized by Earl after WHR-208 merged. Base: staging 5ff40e0. Original reviewed head: d451af3. Round 1 failed; rounds 2 and 3 remain. Preserve the original pre-build plan in .review/app__WHR-23-stage-2b.md.

The complete original code review is /tmp/whr23-code-review-r1.md; WHR-187's Linear comment also records all findings. Approved design: docs/design/giveaway-checklist-brief.md. Contracts: M4 P-30/T-21. All server/shared/mutation/projection code stays unchanged. Never weaken assertions to match a disagreement; stop and file for T1 on any new server/contract conflict.

## Production fix requirements

- SEC-HIGH: bind frozen reviews and dependent candidate drafts to their action-specific live read authority and view, beyond the account/role epoch. Revalidate before redisplay after navigation/authority change and before first confirmation. Confirmed manager/designation/person authority loss removes protected candidate evidence and controls. Transient failure must not expose an unvalidated review. Preserve the exact uncertain write request for an authorized same-person retry; do not silently rebase it or discard it merely because its successful first attempt changed versions.
- Accept the valid superseded exclusion state everywhere, with distinct retained terminal stale copy and no decision buttons. One such historical row must not break census/history/detail.
- Recovery: a phone with approved unavailability under the current census cannot select an empty inspection against that census, including when applicability/manager context subsequently changed. Require explicit recovery and a recorded replacement census first, matching WHR-208. Preserve old approvals and prior snapshots. Use actual saved check entries to describe the recorded result and linked exclusion, not an older proposal state alone.
- Unchanged reconciliation: retain the new receipt's reconciliation ID, display its own actor/time/reason/checks separately from the snapshot's earlier preparation, and support authorized reopening through latestStoredResultId. Never label historical checks as live.
- Manager review: compare Settings campaign bindings with the subsequent selector guard; refuse stale timing/context before review or confirmation. Do not combine old campaign timing/name with a newer guard.
- Separate authorized read-only census/exclusion/check history from manager-only selectors. Loss of verified person authority removes choices/reviews but retains lawfully readable history with an explanation.
- Direct unavailable-phone URLs must check current named manager plus derived action grant before requesting manager-only selectors. An independent approver must remain signed in and see the restricted state; never intentionally trigger a denial that clears their session.
- Read retry: preserve incomplete page chains, view token and failing cursor in authorized memory on 429/503/network failure. Resume the failed page on retry, with actions disabled until every required page is complete. Permission loss clears the chain; read_view_stale restarts it explicitly. Do not add automatic polling, expand authority or substitute current selections.
- Known missing policy: census, check and unavailable-proposal review/confirm actions are disabled with exact prerequisite copy, while drafting and authorized reads remain available. Handle the race-time server refusal explicitly.
- Use unique IDs and distinguish inspection controls for phones with equal/normalizing labels. Do not derive control IDs solely from visible labels.
- Correct the oversized-body unit test: valid unique partitions and bounds just below/above 32 KiB, assert request_too_large for the oversized request. Retain the separate duplicate-partition assertion.

## Ownership and checks

Frontend builder owns src/client/admin-checklist*, related giveaway clients, src/ui/admin/checklist*, giveaway integration, scoped styles and required shared admin control fixes; focused colocated unit tests. Explicit scope deviations from the original plan: Settings entry for the least-privilege Owner, and shared Reason/SelectField identifiers needed for unique accessible controls. Record rationale without rewriting the historical plan.

Independent test engineer owns tests/checklist/**, tests/e2e checklist and leaderboard acceptance, fresh responsive screenshots/report and smoke execution records in its own worktree. No production edits. Keep the recovered-phone core regression byte-identical to 904078f; it is already on staging. Add direct browser/HTTP evidence for each reported failure, including unchanged stored-check identity, superseded history, authority loss without changed session grants, current-census recovery refusal, duplicate phone labels, missing policy, and transient later-page resume.

Run targeted failing tests before fixes and exact green reruns after. No rate resets, sleeps, retry/timeout increases, skips or broad permissive schemas. Use real compiled Next and disposable PostgreSQL for enabled flows. Recheck fidelity at 1440, 390 and 360. Local full-suite connection/camera limitations remain WHR-207; unchanged print-preview race remains WHR-123. Supported CI is mandatory.

EM reruns final gates, dispatches code/security/integrity read-only on the same head for round 2, routes any fixes within round 3, validates evidence, opens a staging PR and merges only green checks. Feature PR must not change STATUS, coverage-map or lane files. READY includes PR/head, exact counts and smoke path; then stop.
