# Giveaway Stage 2b: round-one fixes smoke

WHR-23 / WHR-187, 20 November 2026. Run on a disposable local PostgreSQL 16 database and compiled production Next server with fictional fixtures only. Production source is equivalent to main `3be473c` (checker source `55982b0`), rebased on staging `7ea3238` containing WHR-217. This records independent acceptance; final EM gates, supported CI and code/security/integrity verdicts remain separate.

## Repeat the smoke

1. As Owner with settings and sales, designate a verified eligible campaign manager. Review every campaign field, current/proposed manager and reason before explicit confirmation. Test a Settings change between context read and selector: show stale evidence and remove review, with no designation saved.
2. As named manager, record a census including all physical phones and every account partition, including disabled staff, leavers and shared accounts. Finish all pages and missing-account coverage before review. Unknown phone-only queues remain unknown. At 1440, 390 and 360 px, verify every full inventory/account ID wraps and every phone action remains reachable.
3. Inspect every partition physically before declaring empty. Review and record the complete phone check. An approved unavailable phone cannot select empty on its old census. “Phone available again” requires a replacement census and fresh complete check; retained exclusion and snapshot history stay unchanged. Equal phone labels must have independently labelled controls with distinct IDs.
4. Propose an unavailable phone with exact eligible incomplete sales, full versions, original attendant, received time, amount/currency and quantity/unit. Read the unknown phone-only totals and attested-attribution explanation. Review the complete frozen list/reason; submit for independent approval. A canonically different verified authorized person independently approves or rejects with reason. No accepted sale or unrelated obligation is waived.
5. Replace a census after a pending proposal. Read its superseded detail: actual audit ID must satisfy unchanged canonical UUIDv7 validation and the full response schema. Show exact stale-evidence copy and retained original reason; no decision action is available. Review approved and rejected terminal copy separately from receipt context.
6. Remove manager designation or verified-person authority without changing session grants. Navigate away/back and try first confirmation. Protected frozen evidence and choices disappear before any proposal POST; lawful census, recorded check and exclusion history remain readable. Independent approver direct proposal URL must remain signed in and must not request manager-only candidates.
7. Fail a later selector page once with 429 or 503. Evidence remains incomplete and actions disabled. Explicit refresh resumes the identical failed cursor/view; the first page is not repeated. A stale view instead requires an explicit full restart. All successful reads and writes must come from actual HTTP handlers.
8. With legitimately missing reconciliation policy, retain readable/draft census but disable certification. A failure-only confirmation refusal must show the policy prerequisite and save no proposal. This injected refusal does not simulate a successful response or claim a legal configured-to-missing policy transition.
9. Simulate lost response after an actual committed manager POST, navigate away/back and explicitly retry the identical operation/body. For unchanged reconciliation, display its own new checklist ID/reason/checks and reopen that result after reload; prior snapshot summary, rows and sources must remain byte-equal with the same snapshot count. E02 displays nine distinct live outcomes and separates immutable historical preparation checks.
10. Check keyboard Shift+Tab focus, the token outline and error-summary focus. At all three widths verify full evidence, reasons, final actions, no page horizontal overflow and at least 48 px phone controls. The app does not inspect actual phone-local queues or replace a station-phone/daylight pilot.

## Commands and unchanged regression

Use an explicitly local `DATABASE_URL`. The fixtures create and remove their own migrated schemas and isolated production Next servers. The ordinary root Playwright config builds the source and starts its separate local web server.

```sh
pnpm exec playwright test tests/e2e/giveaway-checklist-r1.spec.ts \
  --project=desktop --workers=1 -g 'superseded unavailable history'
pnpm exec playwright test tests/e2e/giveaway-checklist-r1.spec.ts \
  tests/e2e/giveaway-checklist-real.spec.ts \
  tests/e2e/giveaway-recovered-phone-contract.spec.ts \
  tests/e2e/giveaway-recovered-phone-http.spec.ts --workers=1
```

Set `WHR_CHECKLIST_CAPTURE` to an explicit local output directory only when replacing reviewed screenshot artifacts. Native matching Playwright 1.64.1 Chromium and pinned Node 26.12.0 run in a local Linux container; the local database and MinIO are fictional test services. No deployed data, secret files, retry/timeout increases, rate resets or sleeps are used.

The entire 2,394-byte superseded regression body is byte-identical to preserved test-only commit `9ae3cb0`, including its original strict ID assertion and exact-copy assertion. First rerun: HTTP 200 canonical UUIDv7, schema issues empty, then one UI exact-text failure (WHR-218). The one-file markup fix separates terminal copy from history context; unchanged whole regression then passed **1/1 (18.2 seconds)**. No contract, parser, projection or mutation was loosened.

Three earlier checker defects were corrected: assert the full recovery notice; expect truthful stale status plus visible recorded exclusion/check history after person loss; advance real Settings after the context read rather than initial campaign discovery. New fixture person-binding IDs use canonical UUIDv7. A separate old decision locator now uses exact text to distinguish terminal copy from its receipt, retaining every required word and outcome assertion.

## Execution record

Independent focused outcomes, screenshot geometry and final test commit are recorded below after execution. Historical blocked runs remain in the earlier smoke runbook and WHR-187; they are not current passing results. EM final-head gates and supported CI must pass before merge.

- First combined focused run across both projects: **53 passed / 3 failed (2.9 minutes)**. All 24 new R1 executions and all four unchanged recovered-phone HTTP executions passed. Three decision failures were strict-mode duplicate text matches (receipt plus terminal span), not a server disagreement.
- After strengthening that locator to exact unchanged approved/rejected copy, both independent decision cases across both projects: **4 passed (28.4 seconds)**. This covers all previously failed cases; it is not a claim of one clean 56-case batch command.
- Typecheck and scoped ESLint over new/changed checklist tests, fixture and fidelity helper: **PASS**, zero scoped warnings. Superseded case remains byte-identical (2,394 bytes); recovered-phone regression files are unchanged from staging.
- Fresh independent fidelity: **42 PNGs**, 14 states at 1440/390/360 CSS px and DPR 2, zero page overflows or PNG/measurement dimension mismatches, **294 visible phone controls at least 48 px**. The longest complete capture is 24,624 pixels. [Report](../../tests/design-parity/giveaway-checklist/REPORT.md) and [dimensions](../../tests/design-parity/giveaway-checklist/dimensions.json). Keyboard/focus and stale-error focus were exercised by real-browser flows.
- Sanitized local logs: `/tmp/whr23-resume-strict.log`, `/tmp/whr23-resume-strict-green.log`, `/tmp/whr23-resume-focused.log`, `/tmp/whr23-resume-decisions.log`. No raw network trace or credentials are published. No new server/contract disagreement was observed.

Full suite, final-head EM gates, remaining reviewer rounds and supported CI remain required before PR merge/READY. This checker does not claim those gates passed.

### Stable capture repair

Final inspection found an asynchronous unavailable-review capture race: its first desktop measurement preceded live review authorization, so the growing document was cut despite agreeing with the earlier measurement. The earlier broad no-clipping wording was corrected. Exact source fields already visible in the draft are insufficient readiness evidence.

The test now waits for the authorized “Submit for independent approval” control at each width; the helper asserts that width, document height and visible control count remain unchanged across the screenshot. A bounded independent local host Next/matching Linux browser run passed **2/2 (41.8 seconds)**, replacing 15 affected unique frames across approval/rejection/recovery and all widths. The repaired desktop review is 3,722 CSS px high rather than 2,053, includes its confirmation in measured controls and visibly reaches the final draft reason/back action. The other 27 frames retain initial measurements and visual inspection; this does not claim the new guard ran on all 42. The aggregate 294 phone controls at least 48 px and zero page-overflow results remain unchanged. Local build, typecheck and scoped lint passed. No production or server change and no further full-suite run were made by the checker.
