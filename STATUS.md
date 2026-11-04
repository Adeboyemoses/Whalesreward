# STATUS.md
Updated: 2026-11-04

## Milestone: M0 Foundation (docs/engineering/roadmap.md); target: end of week 1 after kickoff

## Done this week
- WO-spec-3 (WHR-46): accepted by Earl; M3 contracts merged in PR #16. Closeout PR #21 records acceptance; Done after its green staging merge.
- WO-spec-2 (WHR-40): M2 contracts and model additions; closeout effective when the spec/wo-2-m2-contracts PR merges into staging with green CI. Includes 53 endpoints, all 28 permissions and independent code/security/integrity review. Earl authorized publication and closure on 4 November; final PR and verdicts are linked from WHR-40. No M2 code or screen parity claimed.
- WO-spec-1 (WHR-32): data model (#4, 7d92cb6) and M1 contracts (#5, 76ddc6a) merged with independent security/integrity PASS and all five checks green; PR #1 completes lane setup and closeout on merge. Priority child WHR-37 merged in #6. Earl instructed closure after these merges.
- Codex operating model, agents, skills, review gate and engineering guidelines written (Rook, 4 Nov 2026).
- product-docs symlink to the Fuel Station Loyalty folder created.
- Linear team WhalesReward (WHR) created by Earl.
- WO-core-1 (WHR-1) Repository scaffold merged to staging in PR #3; strict Next.js scaffold, pinned tooling, local services and all five required CI checks passed. ACCEPTED by Earl: "Accepted. Scaffold verified." No product features implemented.

- WO-core-2 (WHR-3): schema and exact helpers merged to staging in PR #10; ACCEPTED by Earl on 4 November; closed in PR #17. Three independent reviewers passed; unit 14, integration 48, time 3 per timezone and all five CI checks passed. Feature services remain out of scope.

- WO-core-1c (WHR-44): exact local auto-mode rules hotfix and retained global-option Git guard protections merged to staging in PR #14. ACCEPTED by Earl on 4 November; all five CI checks and three independent reviews passed. Closed in PR #17.

- WO-core-1b (WHR-41): ACCEPTED by Earl on 4 November ("Accepted. lets close this session"); review-gate fix merged into staging in PR #17 (746ede4). Independent code/security/integrity PASS; all five CI checks green. EM Bash 3.2 review 39/39, guard 94/94, typecheck, lint, unit 18/18 and build passed. Ancestor and unchanged-plan checks preserved. No product flow changed. Accepted close-out PR #19 merged with all five checks green; WHR-41 is Done.

- WO-core-15 (WHR-28): source deployment preparation in PR #22; READY for Earl to provision once the reviewed source and final records merge. Includes App Platform spec, pinned multi-stage Dockerfile, TLS-safe migration/seed jobs, health endpoint, staging banner/noindex/gallery isolation and no-op email. Independent code/security/integrity PASS; EM unit 27, integration 49, typecheck/lint/build, amd64 Docker and actual image runtime checks passed. Full CI is required before merge. No doctl or cloud actions run. Runbook: docs/ops/staging.md; cloud validation and deployed URL/redeploy proof remain pending Earl.

## In progress
- WO-spec-3a (WHR-52): bounded capture and independent recovered-correction review amendment; READY after reviewed green staging merge, linked from WHR-52. P-18/P-19 are recorded; Q-528 client confirmation remains pending. WO-spec-4 (WHR-51) is next, unstarted.

- Earl's one-time setup (docs/agentic/setup.md).

- WO-app-0 (WHR-33): M0/M1 implementation briefs and draft phone smoke runbooks; six briefs and three draft phone runbooks prepared for staging; Earl reads row 02 and one runbook after merge. No app implementation or device verification claimed.

## Blocked / decisions needed
- M3 policy gates: WHR-39 (other card retirement); WHR-38 build default approved in P-18, client Q-528 pending, WHR-47–50 (correction evidence, final manager recovery, OTP/device recovery policy, independent meter reconciliation). Specs preserve data and deny unsupported acceptance/mutations pending policy.
- M2 policy tracking: WHR-42 (D06 token/delivery configuration), WHR-43 (proposed role preset activation). Defaults preserve reference values while production policy remains explicitly configured; no new provider or cloud resource is authorized.
- Client kickoff and contract: not yet confirmed.
- Earl provisions temporary staging in Cloudrock’s existing account using docs/ops/staging.md. Client-owned production and account handover remain pending.
- Launch date versus the December campaign start.

## Next up
- WO-core-15 stops at READY for Earl’s provisioning, provider spec validation, private bucket/CORS and three secret settings, HTTPS health/gallery checks and next-merge redeployment proof. WHR-41 is closed. WHR-4 attendant sign-in remains approved for a separate core session; WO-spec-4 (WHR-51) follows WHR-52 READY in a new session; not started.

## Known risks
- Five-to-six-week estimate against a November launch target for a December giveaway.
- Brand and product name awaiting client sign-off (Q-516).
- Verification provider, token expiries and role matrix not decided (D06).

WO-app-0 findings (2026-11-04): draft runbooks split by capture/local-save versus server confirmation; row 02 checks expiry and omits the M2 registration link in M1. Ready after findings PR merge for Earl’s re-read; phone execution remains pending implementation.

WO-app-1 (WHR-2): ACCEPTED by Earl on 4 November 2026: “Earl accepted WO-app-1 (WHR-2); close it.” Foundation PR #12 and wrap fixes PR #20 are merged into staging. Independent component and viewport checks are recorded in docs/qa/design-system-fidelity.md and design-system-wrap-fidelity.md. Closeout is documentation only. WHR-45 remains separately tracked.

WO-app-2 (WHR-5): BUILD under Earl’s explicit session go. Smoke runbook written before implementation; typed M1 client adapter and test-only contract fake precede real WO-core-3 endpoint integration. Stop at READY with Playwright green; Earl’s phone smoke waits until WO-core-3 merges.
