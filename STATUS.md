# STATUS.md
Updated: 2026-11-04

## Milestone: M0 Foundation (docs/engineering/roadmap.md); target: end of week 1 after kickoff

## Done this week
- WO-spec-2 (WHR-40): M2 contracts and model additions; closeout effective when the spec/wo-2-m2-contracts PR merges into staging with green CI. Includes 53 endpoints, all 28 permissions and independent code/security/integrity review. Earl authorized publication and closure on 4 November; final PR and verdicts are linked from WHR-40. No M2 code or screen parity claimed.
- WO-spec-1 (WHR-32): data model (#4, 7d92cb6) and M1 contracts (#5, 76ddc6a) merged with independent security/integrity PASS and all five checks green; PR #1 completes lane setup and closeout on merge. Priority child WHR-37 merged in #6. Earl instructed closure after these merges.
- Codex operating model, agents, skills, review gate and engineering guidelines written (Rook, 4 Nov 2026).
- product-docs symlink to the Fuel Station Loyalty folder created.
- Linear team WhalesReward (WHR) created by Earl.
- WO-core-1 (WHR-1) Repository scaffold merged to staging in PR #3; strict Next.js scaffold, pinned tooling, local services and all five required CI checks passed. ACCEPTED by Earl: "Accepted. Scaffold verified." No product features implemented.

- WO-core-2 (WHR-3): schema and exact helpers merged to staging in PR #10; ACCEPTED by Earl on 4 November; closed in PR #17. Three independent reviewers passed; unit 14, integration 48, time 3 per timezone and all five CI checks passed. Feature services remain out of scope.

- WO-core-1c (WHR-44): exact local auto-mode rules hotfix and retained global-option Git guard protections merged to staging in PR #14. ACCEPTED by Earl on 4 November; all five CI checks and three independent reviews passed. Closed in PR #17.

- WO-core-1b (WHR-41): ACCEPTED by Earl on 4 November ("Accepted. lets close this session"); review-gate fix merged into staging in PR #17 (746ede4). Independent code/security/integrity PASS; all five CI checks green. EM Bash 3.2 review 39/39, guard 94/94, typecheck, lint, unit 18/18 and build passed. Ancestor and unchanged-plan checks preserved. No product flow changed.

## In progress
- WO-spec-3a (WHR-52): bounded capture and independent recovered-correction review amendment; READY after reviewed green staging merge, linked from WHR-52. P-18/P-19 are recorded; Q-528 client confirmation remains pending. WO-spec-4 (WHR-51) is next, unstarted.
- WO-spec-3 (WHR-46): accepted by Earl; closeout PR #21 merges before Done.

- WO-spec-3 (WHR-46): M3 contracts (38 endpoints), model additions and documentation coverage prepared; READY takes effect on the reviewed staging merge with green CI. Independent verdicts and final PR recorded on WHR-46. No product implementation or screen parity claimed.
- Earl's one-time setup (docs/agentic/setup.md).

- WO-app-0 (WHR-33): M0/M1 implementation briefs and draft phone smoke runbooks; six briefs and three draft phone runbooks prepared for staging; Earl reads row 02 and one runbook after merge. No app implementation or device verification claimed.

## Blocked / decisions needed
- M3 policy gates: WHR-39 (other card retirement); WHR-38 build default approved in P-18, client Q-528 pending, WHR-47–50 (correction evidence, final manager recovery, OTP/device recovery policy, independent meter reconciliation). Specs preserve data and deny unsupported acceptance/mutations pending policy.
- M2 policy tracking: WHR-42 (D06 token/delivery configuration), WHR-43 (proposed role preset activation). Defaults preserve reference values while production policy remains explicitly configured; no new provider or cloud resource is authorized.
- Client kickoff and contract: not yet confirmed.
- Client DigitalOcean account for staging and production (needed by M4/M5).
- Launch date versus the December campaign start.

## Next up
- WO-core-1b is accepted; session closed after the acceptance documentation PR merges. WHR-3 and WHR-44 are accepted; both issues are Done following PR #17. WHR-4 attendant sign-in remains approved for a separate core session; WHR-46 M3 contracts belongs to lane:spec.

## Known risks
- Five-to-six-week estimate against a November launch target for a December giveaway.
- Brand and product name awaiting client sign-off (Q-516).
- Verification provider, token expiries and role matrix not decided (D06).

WO-app-0 findings (2026-11-04): draft runbooks split by capture/local-save versus server confirmation; row 02 checks expiry and omits the M2 registration link in M1. Ready after findings PR merge for Earl’s re-read; phone execution remains pending implementation.

WO-app-1 (WHR-2): design assets, 16 typed wrappers, dev-only gallery and responsive shells prepared for staging. Independent gallery10/10 and production browser4/4 checks passed; report docs/qa/design-system-fidelity.md. Earl’s phone smoke remains pending.

WO-app-1 PR #12: implementation and fidelity checks pass. Earl approved one additional synchronized-head review round (“proceed”, 4 November 2026); READY after final review, evidence and green CI permit the staging merge. Phone smoke acceptance remains pending.

WO-app-1 FIX: wordmark and narrow LoyaltyCard footer findings addressed with actual 390px/360px regression/fidelity checks; READY after findings PR review, green CI and staging merge. Real phone/TalkBack may wait for staging URL; WHR-45 remains separate.
