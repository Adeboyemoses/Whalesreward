# Admin row 04: Overview
Boards: B02-Overview · Feature: F10 · Invariants: I-07, I-09, I-40, I-42, I-44, I-45
Decision note: product-docs/04 UI Design/Admin Portal/Admin Overview Screen Decisions.md

| Board | Route | Components (src/ui) | Reads (contract) | Writes | States | Permission |
|---|---|---|---|---|---|---|
| B02 | /admin | KPI, Attention, DataTable, ListRow, Notice | M4 GET /api/admin/overview | None | loading, error/retry, empty, populated, launch unset, restricted projections, denied | overview; sales for attention/recentSales; customers for recentCustomers |

## Behaviour
- Render server-chosen Lagos day, recordedToday and customersSinceLaunch; no campaign or giveaway KPIs. Null launch is unavailable, never zero or a board sample.
- Attention cards use each server destination and matching status filter, without added day/customer filters or a combined count. Recent lists show at most server-provided five; null projections are unavailable, not empty.
- Use current session permissions for links as well as server projection. No phone, photos or evidence are added.
- Use exact shared formatting. Never recalculate totals or credit from statuses.

## Copy
- “Recorded spend today”, “Completed purchases”, “Customers registered”, “Since launch”; null: “Launch date not set”.
- Flagged sales remain counted unless an admin cancels them. Incomplete counts cover server-visible records only.
- The newer 4 November note and board use side-by-side recent sections; this supersedes the older stacked proposal. The M4 contract removes sample date/identity/counts and adds permission/null states.

## Contracts needed
- Existing M4 Overview and shared totals schemas, no contract/server change.

## Open questions
- None; configuration remains unset unless returned by the server.
