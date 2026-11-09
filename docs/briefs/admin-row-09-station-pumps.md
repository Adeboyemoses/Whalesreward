# Admin row09: Station pumps
Boards: F01 → F02 → F03   Feature: F01/F04   Invariants: I-04/I-05/I-07/I-29/I-31/I-32/I-41
Decision note: product-docs/04 UI Design/Admin Portal/Admin Pump and Price Decisions.md (Hi-fi flow4Nov plus later approvals).
Inputs reviewed: HTML and PNG for all three boards; wr-admin/sidebar/pagehead/table/sheet/two-col/kv/notice controls.

| Board | Route | Components (src/ui) | Reads (M2) | Writes | States | Permission |
|---|---|---|---|---|---|---|
| F01 | /admin/pumps | AdminShell, DataTable, Button | GET pumps, paginated configured attendants only when authorized | none | loading/list/empty/error/unconfigured price | pumps OR attendants OR prices for configuration; no attendant identities with prices alone |
| F02 | /admin/pumps/new | sheet, TextField, product select, context kv | GET products and configuration | POST pumps {operationId,name,productCode} | empty/invalid/busy/duplicate/connection/created/cancel | pumps |
| F03 | /admin/pumps/:pumpId | two-col details/assigned list/history | GET pump, pump attendants, assignments with cursors | none; link assignment flow | created/ordinary/unassigned/list/history/denied/partial error | configuration OR grants; attendant/history only pumps OR attendants |

## Copy
Keep “Station pumps”, “Add pump”, “Manage pump”, “Pump details”, “Assigned attendants”, “Assignment history”, “No attendant assigned yet”. Production removes prototype data, simulated success and fixed prices; generated IDs/server receipts only. No pump edit/product change/removal/deactivation, scheduling or individual price overrides.

## Contracts needed
Use existing shared station schemas; validate response envelopes and null price. Derive product/unit from server. Pump creation has no extra reason or confirmation (M2 overrides blanket design-guide wording); Cancel creates nothing. Assigned names require the authorized attendant read, never infer them from count. From pump details, use the narrow paginated assignment-candidates flow rather than broad account access without attendants grant.

## Behaviour
- Read docs/engineering/contracts/m2.md as the normative API: live server authority, UUIDv7 operation IDs, exact expected versions, same key/body after an uncertain response. Conflict requires reread/new review/new key; never automatic resubmission.
- Use the accepted persistent admin session/layout and client navigation; protected state and credentials stay in memory and are cleared on authority/account/route changes. Healthy background checks preserve drafts. Late callbacks cannot navigate or restore a departed view.
- Loading stays inline with context; empty/unconfigured, disconnected, stale, rate/permission and malformed-response states are explicit. Paginate server cursors, preserving filters; picker completeness must not be limited silently to the first25.
- Use vendored design tokens and wr- classes; table scrolling inside cards, responsive1440/390, real labelled controls/focus and wrapped long text. Server time formatted in Africa/Lagos; exact money through src/shared/money.ts.

## Open questions
None blocking: approved work order, P-16/P-21 and M2 settle behaviour. Product folder Decisions Since Handoff supersedes older prototype caveats. No new permissions or policy invented.
