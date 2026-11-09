# Admin row10: Product prices and activation
Boards: F05 → F06 → F07 → F08   Feature: F04   Invariants: I-29/I-31/I-32/I-41
Decision note: product-docs/04 UI Design/Admin Portal/Admin Pump and Price Decisions.md (quantity precision, immediate activation, Hi-fi4Nov).
Inputs reviewed: four HTML/PNG boards; wr-table/amount/right, sheet/two-col, input/prefix/select, kv, held/warning/success notices.

| Board | Route | Components | Reads (M2) | Writes | States | Permission |
|---|---|---|---|---|---|---|
| F05 | /admin/prices | shared AdminShell, product table | GET prices | none | list/null configuration/empty/loading/error | prices |
| F06 | /admin/prices/:product/edit | TextField, precision select0..6, required reason, context/history | GET prices and paginated :product/history | none | editing/invalid/history unavailable/connection; Keep editing preserves draft | prices |
| F07 | /admin/prices/:product/confirm | read-only old/new kv, warning, explicit controls | frozen reviewed snapshot; live permission on server | POST :product/activate {operationId,expectedVersion:null or exact,rateKobo,currency,quantityPrecision,reason} | Not yet applied/confirming/uncertain/stale/denied/cancel | prices |
| F08 | /admin/prices after activation | server receipt notice, table/history | refresh current state separately from immutable receipt | none | authoritative success/version/time/actor/reason; late response fenced | prices |

## Behaviour
One price and precision per product shared by all same-product pumps. Activation happens only after server confirmation and uses trusted server time. Existing/in-progress captures keep recorded rate/version/precision; no recalculation or scheduling. Precision-only changes are valid; unchanged rate AND precision refuses no_change. Strict positive naira input at most two decimals parsed with shared exact money helper to kobo strings; no Number/parseFloat/implicit float in money. Blank/unconfigured has expectedVersion=null and no fabricated rate/default meter precision. Old/new values, affected pumps and entered reason stay visible in review; double-click cannot send another key.

## Copy
“Product prices”, “Update price and quantity precision”, “Review price change”, “Confirm price change”, “Not yet applied”, “Confirm new price”, “Keep editing”. Receipt explains new captures use the new settings while earlier sales retain originals. Use actual returned currency/rate/time; never board fixtures or a client Date for activation.

## Contracts needed
Existing station product/price schema and M2 PriceEvent. Server lists/history are paginated where specified. Full HTTP response validation; version conflict reread never overwrites frozen review or silently applies a new version.

## Behaviour
- Read docs/engineering/contracts/m2.md as the normative API: live server authority, UUIDv7 operation IDs, exact expected versions, same key/body after an uncertain response. Conflict requires reread/new review/new key; never automatic resubmission.
- Use the accepted persistent admin session/layout and client navigation; protected state and credentials stay in memory and are cleared on authority/account/route changes. Healthy background checks preserve drafts. Late callbacks cannot navigate or restore a departed view.
- Loading stays inline with context; empty/unconfigured, disconnected, stale, rate/permission and malformed-response states are explicit. Paginate server cursors, preserving filters; picker completeness must not be limited silently to the first25.
- Use vendored design tokens and wr- classes; table scrolling inside cards, responsive1440/390, real labelled controls/focus and wrapped long text. Server time formatted in Africa/Lagos; exact money through src/shared/money.ts.

## Open questions
None blocking: approved work order, P-16/P-21 and M2 settle behaviour. Product folder Decisions Since Handoff supersedes older prototype caveats. No new permissions or policy invented.
