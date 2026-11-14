# WHR-25 admin overview and reports smoke

Use fictional local fixtures for automated checks. Earl may repeat the read/export checks on staging with an authorized admin. Do not seed or change staging configuration.

1. Open /admin as an overview admin. Verify today's Lagos label, recorded spend and completed count against /api/admin/overview. With unset launch, Customers registered reads “Launch date not set”, never 0 or the board sample 5.
2. Open each attention card and check /admin/sales receives exactly late_correction, incomplete or duplicate. No added date filter. A possible duplicate remains counted until cancelled.
3. Check recent sales/customers with corresponding permissions, then without: unavailable sections contain no rows or identity. Direct routes remain server-authorized.
4. Open /admin/reports at 1440 px. Select an inclusive range and all products. Compare spend, purchases, separate litres/kilograms, exclusion buckets and daily values with the query response. Empty results are explicit.
5. Switch By product, By attendant and By pump; preserve dates/product. Confirm captured attribution and server ordering. Page groups and source rows without duplicates. Sources label Reported date or Verified date and included/excluded state.
6. Enter missing/reversed dates: previous metrics, chart, rows and export are unavailable. Restore dates and refresh. Change product and verify all sections update together.
7. Cause a local accepted-data generation change after viewing a report; load another page or export. read_view_stale explains that the report changed, clears stale results and offers refresh. Refresh produces a new consistent view.
8. Prepare PDF and Excel for the viewed generation. Observe pending and ready, download same-origin artifacts, compare metadata/totals/filters. A lost preparation response retries the same operation unchanged. No extra export is silently prepared.
9. In local fixtures only, exercise failed (including Excel precision) and expired artifacts. File failure/expiry offers “Prepare a new export”; a new preparation uses a new ID, with PDF offered for precision failure.
10. Remove reportExport while retaining reports: report stays readable, export is absent/disabled and direct export is forbidden. Remove reports or overview: corresponding route denies and clears displayed data.
11. At 390 px and keyboard-only, check readable controls, visible focus and contained table scrolling. Confirm no board sample values, campaign totals or invented configured dates appear.

## Execution evidence
EM typecheck, lint, production build and 878 unit tests passed. Focused real-stack Playwright: 20 passed, zero failures/skips; actual PDF/XLSX bytes match server checksums. Independent fidelity: one capture test passed, six screenshots and six geometry records at 1440/390 px; all four presentation findings resolved. See `tests/design-parity/reports/REPORT.md`. Full regression results and final independent reviewer verdicts are recorded in `.review/app__wo-12-admin-reports.md` and the feature PR. Native Chromium is sandbox-blocked on this host, so browser checks use the matching Playwright Linux container and disposable local databases. Campaign values remain unset; no staging data or configuration was changed.

Browser report fixtures use a separate migrated schema and production Next server per worker. The default two-worker suite verifies that report history and generations cannot alter concurrent review or sale fixtures.
