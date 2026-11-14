# WHR-25 overview and reports fidelity

Independent checker: test-engineer. Source boards B02, E05, E06 and E07 were compared with the attached production-build captures at 1440 px, deviceScaleFactor 2. E07 and B02 also have actual 390 px captures and metrics. No staging data or configuration was changed. Every successful report/overview response comes from the merged real PostgreSQL HTTP service.

Reports use a fictional 13-row historical week: ₦169,500.00, 135 litres and 20 kilograms. Daily amounts and the product breakdown match the E05 board. The captured attendant/pump identities come from supported historical fixtures, so E06 has more groups and E07 has four pumps rather than the board's illustrative five. Excluded buckets are zero in these captures; pending, held and cancelled source figures are verified separately by the real browser tests.

B02 deliberately captures the honest unset launch state. The historical week is outside today, so today's recorded totals are zero and Customers registered says “Launch date not set”. The recent sales use durable receipt order; the local fixture has no station-linked recent customer registrations and shows its empty state. No sample overview or campaign figure is introduced.

| Board | Match                                                                                                              | Differences                                                                                                                                                                                                                                         | Severity                        |
| ----- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| B02   | Three KPI cards, three amber attention destinations, side-by-side recent sections, correct status/money typography | Current Lagos day and actual session role replace samples. Null launch and the genuine empty recent-customer state replace fictional counts. Long fixture sale codes make rows taller and the recent-sales table scroll within its panel.           | Note: contract/data projection  |
| E05   | Four KPIs, exact daily bars/gridlines, blue exclusions notice, product table and three grouping controls           | Required refresh and as-of/generation/date-basis metadata add vertical space. Native date inputs follow browser locale. Quantities spell out litres/kilograms; exact money uses two decimals on chart labels. All four exclusion buckets are shown. | Note: contract/accessibility    |
| E06   | Same filters/KPIs/chart; captured attendant IDs and usernames; separate quantity columns                           | Additional fictional stable identities produce six groups. Source paging and export lifecycle are connected controls beyond the static board.                                                                                                       | Note: fixture/contract          |
| E07   | Same filters/KPIs/chart; original pump/product identity; separate quantity columns                                 | Four originating pumps in this fixture. At phone width the chart and data tables scroll inside labelled, keyboard-focusable regions.                                                                                                                | Note: fixture/responsive layout |

The inherited portal shell shows only authorized destinations, uses its established navigation order/icons and stacks navigation above content on phones. Those differences predate this work order. This is a content/layout comparison with explicit runtime-data differences, not a pixel-equality claim.

## Findings resolved

- The first capture repeated the visible Sales breakdown heading. The builder retained the accessible table caption and removed its duplicate visible heading.
- At 390 px the chart legend crowded the title. The builder stacks it with token spacing.
- The empty Recent customers panel lacked padding. The final panel uses the designed sheet spacing.
- Product had no visible dropdown affordance because the design system hides the native arrow. The builder added the existing select-wrap and chevron pattern.

Final captures verify those four fixes. No unresolved blocking or visible-fix finding remains. E05's focused date input visibly uses the token focus ring. Every measured report control is 48 px high at 390 px; document width equals viewport at both widths. Tables keep readable type and use contained scrolling rather than overflow the page. No loyalty-card footer exists on these screens.

## Reproduction and evidence

Use a fresh local fixture database with migrations and seed applied. Run:

```sh
pnpm exec playwright test tests/e2e/reports-real.spec.ts --workers=2 --retries=0
pnpm exec playwright test --config tests/design-parity/reports/playwright.config.ts --workers=1 --retries=0
```

The reporting data generation is station-wide. Report browser tests now opt into a worker fixture that migrates a disposable PostgreSQL schema and starts the existing compiled Next artifact on that worker’s own port. Browser base URL, request Origin and fixture DATABASE_URL all use that isolated stack. Other feature tests keep their ordinary stack, so report historical prices and generation changes cannot affect concurrent suites. Worker teardown stops its own Next process, drops only its owned schema and restores environment/origin. The fidelity fixture uses its own disposable database. `WHR_FIDELITY_REUSE=1` skips historical fixture construction when recapturing that exact database after a visual-only change.

This host's native browser is blocked by its macOS process sandbox. A matching Playwright v1.64.1 Linux container ran the actual production build, with temporary runtime-only configs reusing that build for focused captures. Trace, video and automatic failure screenshots are disabled for credential-bearing test sessions. Only explicit sanitized app screenshots are committed.

Visual production candidate: frontend commits `043b526`, `e2f5064`, `3d039ea`, `5580a59`. Final fidelity run: **1 passed (3.5s), 0 failed**. The behavioral suite verifies filters, accepted revisions, exclusions, both source date labels, successful/stale source paging, live permissions, delayed responses, exact-generation exports, downloaded-byte checksums, uncertain same-operation replay and fresh preparation after failure/expiry.

The initial isolated behavioral rerun passed 20 cases. CI then exposed cross-suite interference under its actual two-worker scheduling: a report fixture temporarily changed the shared live catalog and unrelated writes invalidated report generations. The worker-isolated production stack replaces the append-restoration workaround. The unchanged report assertions plus concurrent review-screen and sales/photo workflows now pass **46 cases (56.5s), 0 failed, 0 skipped**, with `--workers=2 --retries=0`. During this run, an active report schema held PMS/gas at 1,000,000 kobo and precision 6 while public retained PMS/diesel at 100,000, gas at 150,000 and precision 2. After teardown no report schema or child server remained and public prices were still unchanged. Typecheck and scoped lint passed; the EM independently runs full final-head gates and the complete two-worker suite.
