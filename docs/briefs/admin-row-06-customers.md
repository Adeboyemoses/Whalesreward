# Admin row 6: Customers and customer purchases

Boards: C01-Customers, B05-CustomerProfile, S08-CustomerSales (only this row's M2 slice). Feature: F02/F03. Invariants: I-07/I-09, I-14/I-15/I-17, I-29/I-42/I-44, I-49/I-50.
Decision note: product-docs/04 UI Design/Admin Portal/Admin Customer Screen Decisions.md. HTML and PNGs inspected before dispatch.

| Board | Route | Components (src/ui) | Reads (contract) | Writes | States | Permission |
|---|---|---|---|---|---|---|
| C01 | /admin/customers | persistent AdminShell, toolbar, DataTable | POST customers/search {query?,category?,cursor?,limit?} | none | loaded, filtered, empty, loading, error, cursor pages, permission loss | customers |
| B05 | /admin/customers/:customerId | sheets, LoyaltyCard, KeyValueList, KPIs, history table | GET customers/:id; purchases only with both grants | none | ready, no active card, unknown provenance, pending/held/cancelled/credited, no sales grant, error/revoked | customers; history also sales |
| S08 | /admin/sales?customer=:customerId | customer context banner, scoped purchases table | GET customers/:id/purchases and customer profile | none | customer scope, all dates, pagination, empty/error, denied, return to customer | customers AND sales |

## Behaviour
- Keep query/category/page results in memory in the persistent portal provider, above route-keyed details; Back returns the same search/category. Never use names/phones in URLs. Lists are bounded cursor pages and are not whole-dataset totals; preserve bound filters when requesting nextCursor.
- Scope caches and pending requests to account, permission epoch, route/filter and customer ID. Refresh/focus must retain healthy content. Definitive auth/permission change clears protected state and fences old responses. No browser persistence or admin SW cache.
- Render only server-masked phone. Full phone never inferred from search input or unmasked in profile. Legacy null provenance is Unknown/not recorded, never current assignment or card linkage.
- Recorded spend/count and product/unit quantities are server totals; pending values separate. BigInt kobo and exact quantity helpers, including large aggregate values without Number conversion. Never combine litres/kilograms or recompute qualifying spend from visible rows. Credit status/holds/duplicate/correction flags explain the server row, never grant credit locally.
- Customer-only permission shows profile/totals as allowed but never fetches purchase rows or photos. S08 requires customers AND sales on server and UI. Cards-only inventory cannot reveal customer identity. No full sales/photos/review endpoints in this work order.

## Copy and declared board differences
- Preserve Customers, Find a customer, Registered customers, Customer details, Fixed category, Registered at, Recorded spend, Completed purchases, Pending and Purchase history.
- Current seven-character codes replace C01/S08's older six-character samples. Unknown legacy registration station/actor stay unknown. Remove prototype sample labels and invented sample totals.
- B05's Update phone number / Replace lost card and C02–C05 remain M3; omit controls. S08's broader sales search/status filters/detail/review links have no M2 endpoint; this slice displays supported customer-scoped paginated reads and Back to customer, without inventing global sales filtering or decisions. Declare this difference in parity/PR.

## Contracts needed
customerSearchSchema, customerSummarySchema/customerProfileSchema/customerSaleSchema. Wire money/counts/quantities are exact decimal strings; nullable registration provenance is intentional. Existing m2.md endpoints are complete.

## Open questions
None blocking; no expansion into deferred account recovery or M3 sales.
