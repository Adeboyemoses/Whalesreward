# Giveaway Stage 2b: round-one fixes smoke

**Latest independent fidelity sign-off:** final production equivalent to `3e8104f` / builder `45ab102`: 48 fresh frames, 16 states, 1440/390/360 CSS px, DPR 2, 394 phone controls at least 48 px, zero page overflow and matching complete PNG/document dimensions. Earlier counts below are historical execution records. Final EM gates, reviewer verdicts and CI are separate.

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

## Round-two regressions

The new `giveaway-checklist-lease.spec.ts` tests scoped authority lifetime, legal original-kind replay and concurrent unchanged reconciliation history using real HTTP and fictional isolated schemas.

- Baseline same-URL SPA remount observations (manager/person) passed 2/2. With character-data observation and an actual delayed pre-unmount authorized response, all three lifecycle cases passed 3/3 (29.9 seconds). These browser observations did **not** reproduce a protected-DOM insertion on the baseline source; no red lifecycle proof is claimed. They still assert no insertion while a current checklist read is held, followed by actual 403 protected-selector refusal after authority loss. The delayed successful response was fetched from the real server before unmount/revocation, not fabricated.
- Two other baseline findings were reproduced: **0 passed / 2 failed**. A committed initial phone-check response was deliberately lost; another verified authorized admin prepared and saved the initial snapshot. The manager retained only the original `giveawayFinalize` grant. An identical real HTTP initial-kind receipt replay returned 200, but the browser cleared its uncertain request before sending a second POST. Separately, an independent session created unchanged reconciliation B after local A; refreshed HTTP returned B as `latestStoredResultId`, while the UI still labelled A as latest.
- The production fix is builder `45ab102`, equivalent to main `3e8104f`. The original-kind test requires two identical browser request bodies and exactly one phone check/snapshot. The concurrent-history test requires exact distinct A/B IDs and reasons in separately labelled own-receipt/latest sections, all nine stored checks, and byte-equal original snapshot detail/rows/sources with one snapshot.

Logs: `/tmp/whr23-lease-red.log`, `/tmp/whr23-lease-generation-red.log`, `/tmp/whr23-r2-extra-red.log`; final focused verification is recorded after execution below. Strict superseded and recovered-phone regressions remain unchanged. These focused observations do not replace final EM gates, formal round-three review or supported CI.

Final round-two checker execution on builder `45ab102`: **18 passed (1.6 minutes)** across both projects. This includes all five new cases, existing manager/person frozen-review eviction, first confirmation live-authority rejection and the original uncertain manager exact-body retry. Original-kind replay and latest-B were red before the fix and green afterward. Lifecycle baseline tests passed too; a DOM leak is not claimed reproduced. Typecheck and scoped lint passed. Log: `/tmp/whr23-r2-green.log`.

The A/B history state adds three independently inspected captures at 1440/390/360, DPR 2, with exact distinct IDs/reasons and settled pre/post geometry. Full PNG heights: 28,094 / 40,654 / 41,650 px. Combined evidence now has **45 frames, 344 phone controls at least 48 px**, zero measured page overflow and matching PNG/document dimensions. [Report](../../tests/design-parity/giveaway-checklist/REPORT.md). Other screenshots were not unnecessarily recaptured; the three new frames specifically cover the added separately labelled own receipt. No physical device or full accessibility audit is claimed. Native runner released for the EM's final full suite and remaining review.

### Historical preview capture readiness

The final EM full run exposed another capture race: frozen historical checks were visible while the confirmation route's live projection/preview still loaded (6 controls / 4,416 CSS px grew to 16 / 7,294 during the screenshot). The pre/post geometry guard correctly failed; this was not accepted as a fidelity pass or a server/contract disagreement.

The test now requires the confirmation URL, all nine current outcome headings, all nine frozen passes, an enabled actual confirmation (which binds the completed live projection and exact preview), and no evidence-loading message before capture. No height polling, sleep, retry or timeout increase was added. On rebuilt final production source equivalent to `3e8104f`, the bounded case passed **1/1 (22.9 seconds)** including the invariant that later intake blocks live readiness while the original historical pass remains unchanged. The replaced three frames passed the stable-layout guard: CSS heights 7,294 / 11,936 / 12,312, PNG heights 14,588 / 23,872 / 24,624 at 1440 / 390 / 360; 16 visible measured controls in each, phone controls at least 48 px, no page overflow. Build, typecheck and scoped lint passed. Log: `/tmp/whr23-historical-final.log`.

### Final frozen fidelity set

The EM froze 45 completed native Linux desktop-project PNG/JSON pairs before later attendant tests could overwrite names. The checker merged those with the three corrected Historical-preparation frames from rebuilt current-source host Next/matching local Linux browser. **All 48 final images use production equivalent to `3e8104f`; no older-source frame remains.** This includes the latest-unchanged-reconciliation three frames generated by the full suite, beyond the earlier 45-frame focused set.

Final dimensions: 16 states × 1440/390/360, DPR 2, **394 visible phone controls at least 48 px**, no page overflow, exact complete PNG/document sizes, longest PNG 41,650 px. All final captures passed the stable pre/post geometry/control guard after durable UI readiness; complete final actions and wrapping were inspected. These are resized desktop Chromium contexts, not a physical-device or mobile-user-agent audit. [Final report](../../tests/design-parity/giveaway-checklist/REPORT.md) and [dimensions](../../tests/design-parity/giveaway-checklist/dimensions.json). No later attendant captures will overwrite this signed-off set. Full-suite success is not inferred from capture completion.
