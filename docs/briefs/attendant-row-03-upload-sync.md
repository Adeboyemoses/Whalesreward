# Attendant row 03: Uploads and server-confirmed receipts

Boards: A08-PendingUploads → A23-PendingUploadsEmpty → A14-PriceReview; linked row 02 A04-SaleSynced and row 06 A16-GasSynced. Feature: F04/F05. Invariants: I-03, I-06, I-22–I-28, I-31, I-33–I-35, I-48–I-50. Work order: WO-app-3 (WHR-7).
Decision note: product-docs/04 UI Design/Attendant Mobile/Attendant Sale Screen Decisions.md, including Hi-fi flow — 4 November 2026. Five PNGs and HTML inspected 5 November 2026. This supplements the existing row 02/03/06 capture briefs for the upload slice.

| Board | Route | Components (src/ui) | Reads (contract) | Writes (contract) | States | Permission |
|---|---|---|---|---|---|---|
| A08 | /attendant/uploads | AppHeader, ListRow, StatusPill, Notice, Button, BottomNav | account OutboxRow, SaleStatus | submit, permission, PUT, finalize, status through client | saved, submitting, photo pending/failed, uploading, finalizing, offline, expired, needs attention, cancelled reason | active originating account; uploads require valid window |
| A23 | /attendant/uploads | ResultBlock, Notice, Button | durable server status and pending count | refresh status | zero waiting; held/cancelled remain honestly labelled | originating account |
| A14 | /attendant/uploads/:saleId | ResultBlock, ListRow, Notice, StatusPill | SaleStatus holds, immutable original | status refresh only for durable held | price, card/date/mixed holds; zero credit; no re-upload action | originating account |
| A04 | /attendant/sale/:operationId/recorded | ResultBlock, KeyValueList, Notice, Button | original plus validated SaleStatus | status refresh | saved/pending, credited, held, cancelled, needs attention | originating account |
| A16 | same receipt route | same receipt components | gas original and SaleStatus | status refresh | Cylinder, kilograms, credited only from server | originating account |

## Behaviour

- Follow M1 exact envelopes, same operation IDs, immutable originals and persisted finalize request. A network event or PUT result never authorizes credit (F04/F05; I-22/I-26).
- Account-scoped client owns all writes; no UI direct Dexie mutation. Stop uploads on offline, sign-out, account switch, revocation or expired window. Keep data and original attribution (I-03/I-06).
- Unknown submit/finalize checks status before retry. Expired upload permission uses new permission operation ID and unchanged blob. Never persist/log signed URLs. Backoff 1–60 seconds with jitter and Retry-After; manual retry honors limits. Leases prevent competing tabs.
- Receipt credit requires validated state=credited, credited=true, photoValidated=true, customer and revision, no holds. Held/photo-complete leaves waiting count but stays visible and never says Synced. Cancelled without photo must not claim every photo reached server; show cancellation reason (M1).
- Foreground sync and manual retry work. Upload-first offers progress and failure; leaving pending locks the partition. No automatic deletion (F01/F05).
- View details reuses immutable receipt data; no M3 history/correction scope. Next sale resets captured input and retains pump/Cylinder context.

## Copy

Use “Sale synced”, “Details and photo received. Added to {server customer}'s loyalty total.” only for credited. Use “Saved on phone”, “Photo upload failed”, “Awaiting price review”, “Retry uploads”, “All uploads complete”, “Record next sale”. Render monetary values with exact helpers and Lagos dates. Phone tap targets 48 px; vendored tokens/wr classes; 390 and 360 widths.

Approved contract deviations: A14's sync-time price comparison becomes unresolved historical price review; A23 must not imply every uploaded sale is credited or refer to unbuilt History. Missing photos on cancelled records must not be described as received. ServerReceivedAt is details receipt, not photo-finalization time: do not invent a photo-received timestamp. Gas labels spell kilograms; kg remains acceptable where the board abbreviates it. Capture values remain immutable after review; M1 does not provide revised amounts.

## Contracts needed

Existing M1 Session, OriginalSale, OutboxRow, SaleStatus and upload/finalize bodies. Extend src/client/api.ts and runtime schemas to these shapes; no new endpoint or contract invented. Test-only contract-shaped fake; real endpoints belong to WO-core-4.

## Open questions

None blocks the approved slice. Real server and Android exactly-once acceptance remain pending dependencies, explicitly separate from READY automation. Existing meter/rounding proposals remain unchanged.
