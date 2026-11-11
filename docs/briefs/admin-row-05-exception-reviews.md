# Admin row 05: Exception reviews

Boards: S02, S03, S04, S06, S07, S09. Feature: F07 and confirmed review rules.
Invariants: I-07, I-09, I-22, I-26, I-31, I-33, I-34, I-35, I-39, I-40.
Decision note: product-docs/04 UI Design/Admin Portal/Admin Sales Screen Decisions.md.
Normative implementation: docs/engineering/contracts/m3.md, P-16/P-20/P-23/P-24/P-25; WHR-17.

| Board | Route | Components | Reads | Writes | States | Permission |
|---|---|---|---|---|---|---|
| Queue | /admin/sales/reviews | PageHead, DataTable, SelectField, Notice | sales/search review-kind filters | none | loading, empty, filtered, error, forbidden | sales |
| S02 | /admin/sales/:saleId/duplicate | Sheet, KeyValueList, AdminSalePhoto, Reason, Button | latest pair, flag, both SaleGuards | duplicate decision | open, comparison unavailable, confirmation, uncertain retry, stale, closed, result | sales + duplicates |
| S03 | /admin/sales/:saleId/price-review | Sheet, KeyValueList, AdminSalePhoto, Notice | latest sale, hold, API references | accept_captured only | held, evidence unavailable, insufficient, confirmation, stale, forbidden, uncertain retry, result | sales + priceReview |
| S04 | /admin/sales/:saleId/price-review/correct | Sheet, Notice | latest sale | none | Not available yet; back to review | sales |
| S06 | /admin/sales/:saleId/card-review | Sheet, KeyValueList, AdminSalePhoto, Reason | latest sale/hold/replacement/references | confirm_earlier or cancel | held, insufficient, unavailable, confirmation, stale, forbidden, uncertain retry, result | sales + cardEligibility |
| S07 | /admin/sales/:saleId/date-review | Sheet, TextField, Reason, AdminSalePhoto | latest sale/hold/references | verify Lagos date | held, invalid date, after receipt, insufficient, confirmation, stale, forbidden, uncertain retry, result | sales + dateReview |
| Capture | /admin/sales/:saleId/capture-review | same review sheet vocabulary | latest sale and all open capture blocks/references | confirm or cancel, no synthetic hold | held, insufficient, unavailable, confirmation, stale, forbidden, uncertain retry, result | sales + dateReview |
| S09 | decision result in review route | Notice, KeyValueList, history | immutable Decision then current detail | none | credited, still held, cancelled, historical replay | matching decision permission |

## Behaviour
- Extend WO-app-7 sale detail and existing session/transport guards. Queue and detail links preserve customer context where applicable.
- Read-only originals and real retained photo remain visible. Duplicate pair is side by side with named cancellation target; similarity alone is not proof. Keep-both clears only the flag and grants no credit.
- Every enabled action requires trimmed reason, review impact, then explicit confirmation. Keep reviewing performs no write. Successful outcomes show server decision actor/time/reason and actual credit consequence; remaining holds remain visible.
- ReviewEvidence uses only the same-sale validated asset and selectable opaque references offered in the latest SaleDetail (purchase, photo, captured price version and replacement event when available). References are optional supplements; the server assembles the full required closure. No dedicated reference-list endpoint is assumed. Notes are required explanation, never proof. No upload, URL input, free-form reference entry or witness path.
- Freeze route, body, operation ID and latest-read SaleGuard/hold/flag versions for confirmation. After an uncertain send, lock edits and offer explicit same-operation retry only. Malformed success, unreadable response and transport failure cannot mint another key. Stale/closed errors require reread and fresh explicit review; never substitute new versions into an old decision.
- Current permissions gate actions and must be rechecked after permission errors. Account/session changes discard stale personal views; responses from an old view cannot update a newer one.
- P-25: price accepts only captured rate valid throughout the server interval. Card confirmation requires all possible capture before replacement; cancellation requires all capture at/after replacement. Date needs one supported Lagos day. Capture covers every open capture block together; server determines sufficiency.

## Copy and board differences
- Keep exact “Clear the flag · keep both”, “Confirm decision”, “Keep reviewing”, “Decision reason”.
- “Evidence notes · explanation, not proof”; explain that notes cannot settle missing records.
- evidence_insufficient: “The records don't settle this yet.” Leave held, without suggesting longer notes will help.
- Explain version_conflict, review_closed, sale_not_cancellable, permission changes, date_invalid and date_after_receipt in plain language.
- P-25/WHR-50 override S03/S04's working meter editor and price cancellation: display “Not available yet” with explanation, never send these mutations.
- P-25 overrides board example notes/shift logs as evidence. No manual reference entry.
- Credit is conditional on every other gate, overriding board examples that assume all checks passed. Do not invent aggregate impact totals absent from API.
- Use vendored wr- components/tokens, 1440px desktop and responsive layout. S09 shares outcome style with WO-app-7.
- Current SaleDetail returns a captured price reference and no replacement detail. Do not relabel that price as current or invent replacement times/cards; label unavailable context honestly.

## Contracts needed
Use existing strict schemas under src/shared/contracts and merged WO-core-9/9a endpoints. Money stays kobo strings; quantities exact decimal strings; dates Lagos calendar strings. No server/schema/contract change is planned.

## Open questions
None; runtime policy activation remains outside this work order. Tests use an approved local fixture policy.
