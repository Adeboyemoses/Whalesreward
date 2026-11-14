# Admin row 12: Reports
Boards: E05-Reports → E06-AttendantReport → E07-PumpReport · Feature: F10 · Invariants: I-07, I-09, I-29, I-40, I-42, I-44
Decision note: product-docs/04 UI Design/Admin Portal/Admin Reports Decisions.md

| Board | Route | Components (src/ui) | Reads (contract) | Writes (contract) | States | Permission |
|---|---|---|---|---|---|---|
| E05 | /admin/reports, product grouping | TextField, KPI, Notice, SegmentedControl, DataTable, Button | reports/query, reports/sources | reports/exports | loading, populated, empty, invalid dates, transient error, stale generation/refresh, restricted export, denied; export pending/ready/failed/expired/uncertain | reports; reportExport for export |
| E06 | /admin/reports, attendant grouping | same | same | same | same, captured attendant ID/name/username | same |
| E07 | /admin/reports, pump grouping | same | same | same | same, original pump identity/product | same |

## Behaviour
- Required inclusive Lagos from/to and nullable product apply together to KPIs, exclusions, daily chart, groups, sources and export. Group tabs preserve filters. Clear old results/cursors immediately when filters change or fail validation. Default to the current Lagos day, never the sample week.
- Draw daily spend only from returned daily values, one currency series at a time; no summed source/client aggregate or inferred zero-sales days. Exact money and decimal quantity formatting; separate litres and kilograms always.
- Paginate groups/sources with exact viewed dataVersion. A read_view_stale result invalidates that view and requires explicit refresh. Label source “Reported date” versus “Verified date”; neither implies campaign eligibility.
- Excluded buckets have plain Pending, Held, Cancelled, Ineligible labels and server-visible-only explanation. Duplicates/proposals do not remove accepted contribution.
- Export PDF/Excel uses returned filters and expectedDataVersion, with one operationId retained for uncertain retries. No implicit regeneration or changed parameters on retry. Status check is creator-authorized; download is same-origin no-store. Failed/expired needs “Prepare a new export” and a fresh operation; precision failure offers PDF.
- Guard concurrent responses against filter/session changes; no personal report persistence or cache.

## Copy
- “Completed recorded purchases · sale dates in Lagos”, “Recorded spend”, “Completed purchases”, “Liquid products”, “Cooking gas”, “Recorded spend by day”, “Sales breakdown”.
- “Pending counts cover records visible to the server.” Operational loyalty figures are separate from giveaway qualification and payment reconciliation.
- Omitted chart dates do not establish zero station sales. Historical sales retain original attendant/pump.
- Contract supersedes the older browser-library export prototype: server prepares immutable artifacts, states and exact generation. Board figures are fictional fixtures only. Litres/kilograms are explicit, never one combined quantity.

## Contracts needed
- Existing M4 report/filter/group/source/export schemas and response envelopes. No server change.

## Open questions
- None; no campaign sample values are introduced.
