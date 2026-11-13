# Admin row 05: Meter correction

Boards: S03 → S04 → S09; Feature: F06 and confirmed price-review outcomes.
Invariants: I-07, I-09, I-26, I-29, I-31, I-35, I-39, I-41, I-48.
Decision note: product-docs/04 UI Design/Admin Portal/Admin Sales Screen Decisions.md.
Normative amendment: docs/engineering/contracts/m3.md, P-26 (WHR-124/126); WHR-132.

| Board | Route | Components | Reads | Writes | States | Permission |
|---|---|---|---|---|---|---|
| S03 | /admin/sales/:saleId/price-review | Sheet, Notice, Button | latest SaleDetail, open price hold | accept_captured; link to editor | loading, held, forbidden, error, closed | sales + priceReview |
| S04 | /admin/sales/:saleId/price-review/correct | Sheet, TextField, AdminSalePhoto, Notice, Button | original/effective pair, unit, captured precision, SaleGuard, open hold version, offered evidence references | strict correct_meter priceDecision | editor, invalid, unchanged, missing photo, review, confirm, uncertain same-operation retry, insufficient, unconfigured, stale, forbidden, closed | sales + priceReview |
| S09 | recorded result in correction route | Notice, KeyValueList, AdminSaleHistory | immutable Decision then refreshed SaleDetail | none | credited or still held, historical replay, refresh unavailable | same permission |

## Behaviour

- Preserve the original entry and captured rate/version/precision read-only. Prefill editable fields from the guarded effective pair where available. Both amount and quantity are typed independently from the retained validated photo. Never derive either field from the other or any rate; never suggest a value or compute an implied rate.
- Use shared parseNaira/parseKobo/formatNaira and parseQuantity/formatQuantity. Amount allows at most two decimals; quantity uses original unit and captured precision. Reject zero, negative, exponent, malformed, out-of-range and excess precision without rounding. The server compares unchanged values exactly against its latest guarded pair. SaleDetail omits a staged resolution candidate, so do not reject a displayed-original pair locally as unchanged; it may differ from the protected candidate.
- Required reason and evidence explanation; retain API-offered same-sale references only. Notes are explanation, not proof. No upload, external URL or free reference field.
- Explicit review followed by confirmation. Review shows both submitted values and conditional credit consequence; no fabricated aggregate/customer totals. Keep reviewing preserves input; discard does not mutate the sale.
- Reuse frozen decision identity/body and original guards for uncertain same-operation retries, including after navigation. Do not refresh guards inside a submitted decision. Stale or closed errors require reread and a newly reviewed decision. Session changes cannot reuse another admin's pending request.
- Reuse private full-size validated photo viewer; keyboard open/close, focus restoration and unavailable/expired access must work. No personal evidence caching or logs.
- Server decides meter policy, historical rate uniformity, display allowance and credit. Clearing price hold clears no other hold. Original/captured context remains immutable. Price cancellation remains unavailable (P-25).

## Copy and approved board differences

- Keep “Correct from meter evidence”, “Meter amount (₦)”, “Meter quantity (litres)” (or kilograms), “Decision reason”, “Review correction”, “Confirm decision”, “Keep reviewing”, “Discard changes”, “Open full size”.
- meter_policy_unconfigured: “Meter checks aren't set up for this pump yet.” Explain sale remains held.
- evidence_insufficient: explain records may not establish one rate throughout the possible capture period, or typed displays may not fit the meter's allowed rounding difference. Do not claim which subcause occurred when API supplies one generic code. Leave held; do not suggest altered readings.
- no_change: both values match the latest recorded pair; change at least one only if the photo supports it.
- Stale sale/hold/revision: records changed; reload and review again before confirmation. Other errors use existing plain-language guards.
- P-26 overrides S04 sample implied-rate text, guaranteed credit/aggregate totals, and WHR-17's unavailable meter editor. P-25 still overrides working price cancellation. Test profiles are fictional and never production configuration.

## Contracts needed

Existing strict priceDecisionSchema: operationId, SaleGuard, expectedHoldVersion, decision {outcome: correct_meter, amountKobo: integer kobo string, quantity: exact decimal string}, same-sale ReviewEvidence and reason. No contract/server/schema changes.

## Open questions

None. Runtime activation and real meter measurement remain outside this work order.
