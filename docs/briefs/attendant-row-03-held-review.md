# Attendant row 03: Held review

Boards: A14-PriceReview. Feature: F05. Invariants: I-06, I-26, I-31, I-33, I-34.
Decision sources: attendant sale/upload decisions, Admin Sales Screen Decisions, M3 own-sale projection, P-20/P-25.

| Board | Route | Components | Reads | Writes | States | Permission |
|---|---|---|---|---|---|---|
| A14 | /attendant/uploads/:saleId and own sale detail | AppHeader, ResultBlock, ListRow, Notice, BottomNav | own-sale detail/status and same-account local receipt | none | loading, offline/unavailable, price held, other held, resolved, cancelled | originating attendant |

## Behaviour
- Show server-confirmed held state on own sale detail; reuse account-partitioned receipt/history navigation.
- Price heading “Awaiting price review”; other holds “Held” with plain explanation. No policy codes, admin notes, comparison details or foreign sale navigation.
- Say details/photo received only when supported by evidence state. Held is not credited; do not ask attendant to record again.
- “No need to record this sale again. Re-uploading will not clear the price review.” Generalize for other review kinds.
- Preserve original entry and show customer, money, quantity/unit, medium, sale code and View details.
- A14 latest-server-price explanation is superseded by historical capture rules: explain that captured price needs review without claiming the current rate should replace it.
- Use A14 result hierarchy, notice and list card at 390px and 360px, 48px targets, no horizontal overflow. Offline shell remains available; do not cache protected server detail/photos.

## Contracts needed
Existing AttendantDetail and sale status; no admin evidence reference/notes fields.

## Open questions
None.
