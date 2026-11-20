# Admin row 11: giveaway checklist — Stage 2b implementation plan

Boards: E01 → E02 → E04 → E03. Feature F09/F11. Invariants I-07/I-09/I-11/I-26/I-28/I-35/I-40–I-46/I-48/I-49.

Spec: [approved design](../design/giveaway-checklist-brief.md), approved through WHR-167; [M4 T-21](../engineering/contracts/m4.md#granular-outcomes-and-narrow-selections--whr-170--t-21). Earlier [row brief](admin-row-11-leaderboards.md) describes Stage 2a only. Earl's 19 Nov instruction authorizes this implementation against staging 4fe42cd or later.

## Global constraints

- No server, shared-contract, mutation or projection changes. Stop on server/contract disagreement and file for T1.
- No STATUS, coverage-map or lane-file edits. Fictional fixtures only; no actual operational people or dates.
- Exact copy/state tables and responsive layouts from the approved design; vendored wr components/tokens, phone controls 48 px, IDs wrap, all fields visible at 1440/390/360.
- Live resolved is “Resolved as of {time}”; stored clear is “Passed during preparation” with historical time/ID. Missing/restricted data never becomes zero or green; counts overlap and are never summed.
- Phone-only originals remain unknown; phone attribution is attested. All required historical accounts and pages participate; no directory grants, guessed identities or failed-write enumeration.
- Full frozen local review precedes each POST. Exact same operation ID/body on uncertain retry; clear all protected data on session/authority change. No persistent drafts.

| Board/view | Route | Components | Reads | Writes | States | Authority |
|---|---|---|---|---|---|---|
| E02 live and historical checks | /admin/leaderboards/finalize | Sheet, Notice, KeyValueList, outcome rows | checklist, results/:id | existing prepare only | nine ordered outcomes, missing policy, restricted links, stale/unavailable, historical | leaderboards; sales for history |
| Manager | /admin/leaderboards/finalize/manager | Sheet, SelectField, Reason, local review | selection/managers, currentDesignation | manager | empty/ineligible/current/eligible, review, saved, uncertain, stale | Owner + settings + sales |
| Census/inspection | /admin/leaderboards/finalize/phones | cards, reason, checkbox, local comparison | selection/attendants, selection/phones, existing census/check/exclusions reads | censuses, phone-checks | leavers/disabled, all pages, draft/review, checked/pending/excluded, stale/current, before deadline | named manager + sales + leaderboards + kind action for writes; sales + leaderboards for evidence |
| Unavailable phone | /admin/leaderboards/finalize/phones/:phoneId/unavailable | complete phone/source cards, reason, local review | exact incomplete-sources and phone evidence | phone exclusions | phone-only unknown, empty candidates, selected exact sources, full review, pending/uncertain/stale | named live manager with kind action |
| Independent proposal | /admin/leaderboards/finalize/exclusions/:exclusionId | immutable evidence cards, decision select, reason, review | immutable exclusion detail/history | exclusion decision | pending, rejected, approved, terminal, same-person refusal, uncertainty, stale | sales + leaderboards read; independent verified person + kind action writes |

## Review focus

1. Stale pagination or renamed/changed authority invalidates dependent choices; test expectedView/cursor restart with no retained pass.
2. Approver has distinct verified canonical person; test same-person refusal and rejected/approved terminal evidence.
3. New byte receipt or accepted source after selection cannot be excluded; test server refusal without relaxing schemas.
4. Uncertain POST survives navigation with exact request; test lost response/retry and authority clearing.
5. Incomplete account/phone/source lists cannot certify; test disabled/ended accounts, shared partitions, missing coverage and atomic bounds.

## Task 1 — Checklist feature (frontend-engineer)

Own src/client/admin-checklist*, related giveaway adapters, src/ui/admin/checklist*, giveaway integration, child routes and scoped CSS; focused colocated unit tests.

- [x] Read approved spec, T-21, existing Settings/session and Stage 2a patterns; inspect E02/E04 PNG/HTML and decision note.
- [x] Write and run failing contract/parser/frozen-request tests before implementation.
- [x] Add strict client reads for all six projections and unchanged phone mutations/evidence reads. Bind campaign, view and resource identities, freeze bounded requests, preserve uncertain session requests.
- [x] Implement every state/copy in the table and approved design, including complete pagination and explicit review; replace Stage 2a placeholders and render live/stored outcomes distinctly.
- [x] Run typecheck/lint/unit/build. Commit explicit owned files; report exact commands/counts and limitations. No push/PR or delegated agents.

## Task 2 — Independent acceptance and fidelity (test-engineer)

Own tests/e2e/giveaway-checklist*, tests/leaderboards or new isolated checklist fixture/config, tests/design-parity/giveaway-checklist/**. Never modify production.

- [x] Before implementation, prepare failing tests against missing checklist flow using actual production Next HTTP and disposable local PostgreSQL fixtures. Assert exact response contracts, not inferred or mocked successes.
- [x] Test manager designation, complete census including disabled/ended accounts, explicit inspection/certification, exact incomplete-source proposal, independent approve/reject and terminal history, E02 nine outcomes plus stored historical checks.
- [x] Test least privilege, revoked authority, stale page chains, uncertain retry/navigation, missing/pending/stale evidence, unchanged mutations and retained blockers. Stop immediately on a real server-contract disagreement.
- [x] After feature commits, integrate by cherry-pick into isolated test worktree, run real HTTP/browser flows and independent fidelity at 1440/390/360 against approved design/E02 shell. Record screenshots, measured overflow/target sizes and actual differences. Never claim keyboard/focus coverage unless exercised.
- [x] Update smoke runbook with executable steps and real counts; commit explicit tests/evidence. No coverage-map edits.

## Task 3 — EM gates, independent review and staging

- [ ] Integrate test commits, rerun final typecheck/lint/unit/build and user-flow e2e gates; supported CI must be green.
- [ ] Dispatch code/security/integrity reviewers read-only on same exact head; maximum 3 rounds. Route fixes to builder; verify unchanged worktree/head after reviews.
- [ ] Commit evidence alone, validate, push and open staging PR. Merge only green checks at matching head. Report READY with feature/merge SHA, exact local/CI counts, fidelity limits and smoke runbook; then stop.
