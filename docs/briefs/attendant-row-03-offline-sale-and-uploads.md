# Attendant row 03: Offline sale and uploads

Boards: A27-SaleOffline, A05-SaleSavedOnPhone, A08-PendingUploads, A23-PendingUploadsEmpty, A14-PriceReview
Feature: F04–F05 · Invariants: I-03, I-06, I-22–I-28, I-31, I-33–I-35, I-49–I-50 · Work order: WO-app-2 (WHR-5), capture subset

Decision note: `product-docs/04 UI Design/Attendant Mobile/Attendant Sale Screen Decisions.md` (including Hi-fi flow — 4 November 2026); also `Attendant Connected Flow Notes.md` and F&R named feature sections. HTML and PNG for every named board inspected 4 November 2026. Repository brief contains build requirements, not copied source documents.

## Build constraints

Use the vendored design system at `src/styles/design-system/`, `wr-root` at surface root, static client shells (T-12), self-hosted fonts including latin-ext, and typed `src/ui` wrappers. No runtime import from product-docs. Reference widths: 390px and 360px minimum; sticky actions must remain above navigation and keyboard. Real buttons/links, labels, aria-pressed on segments, aria-current on nav, aria-invalid with aria-describedby on errors, accessible icon labels and visible focus. Status always includes text. Dates use Africa/Lagos; money and quantity formatting uses shared exact helpers, never binary floats. Sample names, prices, counts and times are fixtures only.

## Contract status

Reconciled 4 November 2026 against `docs/engineering/contracts/m1.md`; PNG and HTML for A01/A26/A12/A13/A02/A24/A03/A27/A05/A15/A18 inspected before code. `Session`, `PriceSnapshot`, `Lookup`, `OriginalSale`, `OutboxRow` and `OfflineWindow` use that normative contract. `src/client/api.ts` is the typed HTTP boundary; WO-core-3 supplies real sign-in/session endpoints. Contract-shaped fakes are test-only. WO-app-2 ends at atomic local save; A04/A16 and upload/retry/credit states remain WO-app-3.

M1 navigation exposes Sale and Account only until Uploads/History/Register ship. Upload-first stays visibly disabled with an unavailable explanation; leave-pending and stay-signed-in work. The local receipt says the photo is saved and pending, never promises automatic delivery in this slice. `ClientState` is local UI state, never server authority.
## Board map

Parenthetical state descriptions in screens.json are annotations, not literal URL segments. Sale IDs/local IDs are route parameters.

| Board | Route | Components (src/ui) | Reads (contract) | Writes (contract) | States | Permission |
|---|---|---|---|---|---|---|
| A27-SaleOffline | `/attendant/sale` | AppHeader, Notice, TextField, SegmentedControl, PhotoCapture, Button, BottomNav | Session, ProductPrice, minimal CardLookup cache | OriginalSale + OutboxRow | offline in-window; saved customer; unknown local code pending lookup; price snapshot; photo; storage failure | originating attendant session/access; server checks each protected request |
| A05-SaleSavedOnPhone | `/attendant/sale/:localId/recorded` | AppHeader, ResultBlock, KeyValueList, Notice, Button, BottomNav | TODO-CONTRACT local CapturedSale | none | durably saved; upload pending; no credit; next sale | originating attendant session/access; server checks each protected request |
| A08-PendingUploads | `/attendant/uploads` | AppHeader, ListRow, StatusPill, Notice, Button, BottomNav | account-scoped OutboxRow summary | future WO-app-3 retry | details/photo waiting; photo failed after details; online retry; uploading; offline; permanent failure/cancelled reason | originating attendant session/access; server checks each protected request |
| A23-PendingUploadsEmpty | `/attendant/uploads` | AppHeader, ResultBlock, Notice, Button, BottomNav | account-scoped OutboxRow summary, SaleAcceptance | none | zero waiting; receipt confirmed; held records remain uncredited | originating attendant session/access; server checks each protected request |
| A14-PriceReview | `/attendant/uploads/:saleId` | AppHeader, ResultBlock, ListRow, StatusPill, Notice, BottomNav | SaleStatus (WO-app-3) | none | uploaded details/photo; unresolved price hold; zero credit; details; retry does not clear hold | originating attendant session/access; server checks each protected request |

## Behaviour

- Capture offline only in the existing valid 24-hour session. Reopen from generic cached shell and fonts; never cache personal server responses in service worker. Queue partitions by originating account. Original seller/pump/product/rate remain immutable after reassignment. (F01/F05; I-49.)
- If no customer exists in minimal local cache, retain normalized card code and sale for deferred lookup. Do not register offline or claim a resolved name. Only definitive online no-match cancels with reason; network/server failure stays pending. This overrides the guide's blanket resolved-customer-before-save statement for offline capture. (F05.)
- Save record+photo atomically before A05. On quota/transaction failure retain capture form and explain failure; no “Saved on phone”. Browser storage/device loss can lose pending data; no backup promise. (I-23.)
- Auto and manual retries share operation IDs, pause outside originating-account active access, and wait for server confirmation. Details-only receipt is Photo upload failed/pending with no credit. Keep photo locally through failure; retry never creates a new sale. At exact offline expiry uploads pause even when network returns. (I-03, I-06, I-22.)
- A23 means no bytes waiting from this account, not that every sale is credited. Price/card/date holds are distinct and remain visible with zero credit until normal validation clears each. A14 is price review only; no admin resolution action on attendant surface. (I-31, I-33–I-35.)
- Price hold requires unresolved or uncertain mismatch against history at capture; proven capture before activation remains at earlier valid rate. Precision/config-version change alone or sync-time price difference never proves hold. Re-upload does not clear hold. (Newer Sale note price-activation refinement; TRD, I-31.)

## Copy

- “Save sale on phone”; “Saved on phone”; “Upload pending. Not counted toward loyalty until the details and photo reach the server.”
- “Photo upload failed”; “Details received. Photo saved on this phone.”; “Retry uploads”.
- “All uploads complete”; “0 sales waiting”.
- “Awaiting price review”; “Uploaded: details and photo received. Not counted toward loyalty until an admin reviews it.”
- “No need to record this sale again. Re-uploading will not clear the price review.”
- Deviation: A27/A14 imply any current server-price difference needs review. Use capture-time unresolved mismatch wording and captured history instead; never tell a valid earlier-rate sale it is held.
- Deviation: A05 says uploads continue on reconnect. Qualify with same account signed in and offline access valid; connectivity never renews access.

## Contracts needed

- **Session**: account ID, display attendant ID, name, username, station/pump/product IDs and labels, unit, current assignment version, last successful online sign-in instant, offline expiry instant and current access status. Credentials are transient sign-in input and never queued/cached/logged.
- **PriceSnapshot**: station/product ID, integer-kobo rate, currency code, price/configuration version, quantity precision, activation instant and saved-at metadata. The captured snapshot is preserved with each sale.
- **Lookup**: normalized printed code (trim, uppercase; no fuzzy match), resolved customer ID/name/fixed category/card status, definitive not-found distinct from retryable failure. Offline minimal lookup cache contains no bulk phone list.
- **OriginalSale + OutboxRow**: operation UUID, card reference, optional resolved customer, original assignment and identity snapshot, basis (amount/quantity), entered/derived exact values, unit, captured rate/price version/precision, capture instant, evidence reference/digest. Save details plus photo blob in one account-partitioned local transaction before showing saved. Wire details remain subject to server validation.
- **SaleStatus (WO-app-3)**: operation ID/server sale ID, first durable receipt instant, validated evidence state, accepted/held/cancelled/pending outcome, explicit credit outcome and reason. Connection alone or client upload success never implies accepted credit.
- **account-scoped OutboxRow summary / RetryOwnQueue**: account-scoped pending count, per-operation details/photo transport state, retryable/permanent reasons, last confirmed upload time, server outcome and separate hold reasons. Photo blob stays local until protocol permits cleanup; no invented retention policy.

## Open questions and boundaries

- The merged M1 contract resolves transport names. Phone acceptance waits until WO-core-3 merges; automation may use contract-shaped intercepted responses. No new product decision is needed.
- Meter precision/halfway rounding and trustworthy capture timing remain configured/proposed as recorded in decisions; this brief settles none of them. No new product decision is required to draft these reversible docs. Missing implementation-specific failure copy must follow existing Notice/TextField patterns and be reviewed in its implementation work order.
- Added boards are approved (P-16); use repo overrides for routes, 48px phone targets, vendoring and Linear questions. No feature flags for Q-520.

Implementation copy deviation: A26 lockout count/unlock policy is not implied by M1 invalid_credentials; show the generic wrong-details message and server-provided retryable states. Quantity display uses the shared formatter (WHR-45 tracks fixed trailing-zero parity).
