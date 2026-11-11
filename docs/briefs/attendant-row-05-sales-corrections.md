# Attendant row 5: Sales history and own correction
Boards: A09, A10, A11. Feature: F05/F06. Invariants: I-06, I-22, I-29, I-37, I-38, I-39, I-48, I-49.
Decision note: product-docs/04 UI Design/Attendant Mobile/Sales History Screen Decisions.md. Normative amendments: M3 P-19/P-22.

| Board | Route | Components (src/ui) | Reads | Writes | States | Permission |
|---|---|---|---|---|---|---|
| A09 | /attendant/history | AppHeader, BottomNav, ListRow, StatusPill, Notice | attendantSalePageSchema plus this account's local originals/corrections | none | loading, empty, error, offline local only, pending, synced, held, correction pending | own attendant |
| A10 | /attendant/history/:saleId | AppHeader, KeyValueList, StatusPill, Notice | attendantSaleDetailSchema and paged history; own same-origin JPEG | none | loading, error, local original, pending/validated/deleted/unavailable photo, revision/correction/decision pages | own attendant |
| A11 | /attendant/history/:saleId/correct | AppHeader, TextField, Button, Notice, KeyValueList | exact current or original-local base, recorded rate/precision, retained photo | correctionSubmissionSchema via separate durable local operation | unchanged, invalid precision, required reason, saved locally, waiting original, submitting, pending validation, applied, awaiting review, stale base, unavailable evidence, expired session | own live write window |

## Behaviour
- Build from board HTML wr-classes, vendored tokens and components; static client shells only. The list merges by original operationId within active account, with server rows in receipt order and local-only rows labelled.
- M3 is normative: never merge a correction into its original. Save operationId, base revision/value digest, numeric edit, reason and evidence reference durably. Bind an accepted original only on exact content match; freeze full submission before sending; replay exact body/key. A local proposal does not claim server receipt or credit.
- P-22 fixes entry basis. All identity/context/evidence fields are read-only. Exact shared helpers calculate the counterpart using recorded settings. Meter-evidence bases cannot be recalculated as ordinary corrections.
- Midnight notice is advisory; only server state declares automatic application or review. One pending correction per sale. Render domain errors in plain words, preserve pending edits and originals.
- No SW history/photo cache; remote history remains transient. Same-origin attendant photo only; revoke blob URLs and fence stale account responses.

## Copy and board differences
- Keep Sales history, Sale details, Correct sale, Back to sales, Recorded entry, Meter photo evidence, Save correction, Cancel edit.
- Add minimal required Reason textarea (trimmed 1..1000). Replace switchable basis with recorded-basis read-only presentation per P-22.
- Show Saved on phone and Waiting for the original distinctly from server outcomes. Later proposals may be sent for admin review; do not promise auto acceptance based on device time.

## Contracts needed
Use existing src/shared/contracts/sales.ts. No new endpoint or shared contract required.

## Open questions
None; the approved work order and M3 settle differences.
