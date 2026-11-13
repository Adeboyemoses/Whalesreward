# Admin row 13: Audit history
Boards: G01–G05 · Feature: F06/F12 · Invariants: I-07, I-09, I-41
Decision note: product-docs/04 UI Design/Admin Portal/Admin Audit History Decisions.md

| Board | Route | Components | Reads | Writes | States | Permission |
|---|---|---|---|---|---|---|
| G01 | /admin/audit | Admin shell, labelled filters, table, pager | POST /api/admin/audit/search | None | loading, results, empty, invalid date/range, denied, expired, transient error | audit |
| G02 | /admin/audit/[eventId] | Event record, reason panel, changes table | GET /api/admin/audit/:eventId | None | admin event, loading, missing, denied, error, legacy | audit |
| G03 | same | same, original seller | same | None | correction decision | audit |
| G04 | same | same, attendant snapshot | same | None | attendant event | audit |
| G05 | same | same, system snapshot, original seller | same | None | system event | audit |

## Behaviour
Use current m3.md audit catalogue (WO-spec-3m) and merged query endpoints. Six rows per page; Previous/Next cursor stack with no guessed totals. Every filter change resets paging. Preserve filters and page when returning from detail. Search, area, actor kind, inclusive Lagos from/to and target UUID combine. Explain invalid dates/ranges. Render event-time actor name/username/code/role and original seller independently; never fetch current identities to replace history. Show immutable target, reason, typed before/after and related event links. Destination pages enforce their own permissions. No mutation controls.

## Copy and board differences
Keep “Audit history”, “Who changed what, when, and why”, “Read-only records”, “Recorded events”, “Event record”, “Reason / reference”, “Recorded changes”, “Before”, “After”, “Back to history”. Legacy rows: “older event, details not available”. No phones, including masked phones; replace board masking claim. No edit/delete/export controls. Add target filter. Replace fictional total pages/count with cursor position and current page count. Shared money/quantity/date helpers format values exactly. Render only actual projected changes; do not invent board sample values or a credit effect from success alone. Use approved tokens/wr-classes, dark system pill, responsive layout.

## Contracts needed
Existing shared audit types and closed catalogue from WHR-20/WO-spec-3m; no contract changes planned.

## Open questions
None: work order overrides phone masking and pagination samples. PR #116 is currently open according to GitHub; audit endpoints are already merged independently.
