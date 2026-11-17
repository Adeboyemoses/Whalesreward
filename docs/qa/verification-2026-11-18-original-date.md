# WHR-181 original date projection verification

Commissioned 17 Nov; branch base `origin/staging` at `03e6c73`.

## Read-side audit

| Place                                           | Finding and disposition                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sales/projections.ts:values(alias,true)`       | Fixed shared original-date expression to read the same purchase's immutable `kind='original'` revision. It preserves a captured non-null date; absence of a revision yields null. Indexed by `purchase_revision.purchase_id`.                                           |
| `sales/service.ts` detail                       | `SaleDetail.original` uses that fragment and is repaired for admin and attendant reads. Top-level `verifiedSaleDate` still reads the aggregate.                                                                                                                         |
| `sales/projections.ts:row`                      | Original displayed Values when no accepted pointer use the repaired fragment in detail, lists and search. Accepted displayed Values still read the accepted revision's date. Candidate dates stay separate.                                                             |
| `reviews/service.ts` accept-captured comparison | Purchase-row original Values use the repaired fragment. Its comparisons use amount, quantity and calculation only; no mutation or decision semantics changed. Candidate reads already use revision Values.                                                              |
| `reviews/release-discovery.ts` preparation      | Already joins the original revision and builds original Values from it. No leak or edit. Current candidate is separately projected.                                                                                                                                     |
| `reviews/release-service.ts`                    | Reads candidate Values from a revision, not purchase-row original Values. No leak or edit.                                                                                                                                                                              |
| `reports/data.ts`, `reports/renderer.ts`        | Report sources are effective/current projections, not immutable original Values. Date uses accepted revision when available, otherwise aggregate verified date, retaining resolved calendar/date-evidence semantics. `valuesSource` identifies numeric source. No edit. |
| `sync/audit.ts:settlementAuditValues`           | Purchase fallback uses the shared repaired fragment; accepted/candidate reads still use revisions. `saleAuditValues` deliberately omits verified date; date decisions add their explicit verified-date field. No historical audit rows rewritten.                       |
| `audit/project.ts`, `audit/service.ts`          | Query retained snapshots and project their allowlisted changes without joining current purchase Values. No leak or edit.                                                                                                                                                |
| `corrections/service.ts`                        | Revision Values read `r.verified_sale_date`; corrections inherit their effective base revision's date. No original purchase-row builder or edit.                                                                                                                        |

## Regressions

- `tests/integration/sale-original-date.test.ts`: ordinary resolution/replay with and without a remaining price hold; original Values and immutable revision facts stay unchanged, aggregate/candidate/accepted dates remain available. Non-null original date prevents a hard-coded-null repair; not-yet-settled purchase covers absent original revision.
- `tests/integration/held-release-service.test.ts`: all four existing SR-05 approval/replay cases now compare original Values and immutable revision facts; date case verifies current/accepted date.
- `tests/release-e2e/original-date-real.spec.ts`: ordinary date decision and independent P-29 date approval, using actual Next HTTP, PostgreSQL and MinIO. Both preserve full admin/attendant original Values, resolved dates and one decision on replay. P-29 preparation matches the immutable original.

The new full-revision fact comparisons omit only permitted lifecycle metadata (`state`, `version`, decision actor/reason/time). The original Values comparisons have no exclusions.

Before the production repair, ordinary service tests failed on null becoming 10 Nov; the non-null-original test failed on 9 Nov becoming 10 Nov. Both real HTTP tests failed on `after.original` equality (ordinary: null to 10 Nov; P-29: null to 11 Nov). P-29 service regression failed identically. Existing expectations were not relaxed.

Run focused tests against a disposable local PostgreSQL database:

```sh
pnpm test:integration tests/integration/sale-original-date.test.ts tests/integration/held-release-service.test.ts --fileParallelism=false
pnpm exec playwright test --config=playwright.release.config.ts tests/release-e2e/original-date-real.spec.ts
```

Set `DATABASE_URL` to that fictional loopback test database. The integration helper uses disposable schemas; release browser config creates and tears down its own isolated schema. HTTP tests use the existing local MinIO fixture on port 9000 and an actual Next server on port 3000; they do not launch a browser or mock routes/auth/storage/decisions. Full gate counts are recorded in the PR review evidence.
