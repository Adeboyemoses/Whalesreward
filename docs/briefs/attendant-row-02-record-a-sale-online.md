# Attendant row 02: Record a sale online

P-23 amendment (WHR-94, 10 November 2026): M1's signed lookup lower bound governs evidence wiring. Accept both strict response projections, normalize absent evidence to null, and enable the capability only after core PR #94. Snapshot the selected evidence before photo/save; cache refreshes cannot rewrite a composed draft or saved original. Store only the minimal account/context-partitioned lookup projection. Preserve legacy originals and photos unchanged. Existing boards, copy and layout apply.

Boards: A02-Sale, A24-SaleCustomerNotFound, A03-SaleFilled, A04-SaleSynced
Feature: F03–F05 · Invariants: I-03, I-04, I-16–I-17, I-22–I-30 · Work order: WO-app-2 (WHR-5), capture subset

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
| A02-Sale | `/attendant/sale` | AppHeader, TextField, SegmentedControl, PhotoCapture, Button, BottomNav | Session, ProductPrice, CardLookup | OriginalSale + OutboxRow | empty; 24-hour access check before capture and save; lookup loading; QR/camera permission failure; missing configuration; invalid numeric input; disabled save | originating attendant session/access; server checks each protected request |
| A24-SaleCustomerNotFound | `/attendant/sale` | TextField, Notice, Button | Lookup | Lookup retry | definitive unmatched card; retryable lookup error; registration link omitted in M1 | originating attendant session/access; server checks each protected request |
| A03-SaleFilled | `/attendant/sale` | AppHeader, TextField, SegmentedControl, PhotoCapture, Button, BottomNav | Lookup, ProductPrice | OriginalSale + OutboxRow | resolved customer; medium selected; amount/quantity; photo taken/retake; ready; saving; local save failure | originating attendant session/access; server checks each protected request |
| A04-SaleSynced | `/attendant/sale/:saleId/recorded` | AppHeader, ResultBlock, KeyValueList, Notice, Button, BottomNav | SaleStatus (WO-app-3) | none | accepted and credited; next sale reset; receipt loading/failure without false success | originating attendant session/access; server checks each protected request |

## Behaviour

- A02 checks the 24-hour window (I-03) before starting capture and again before save. Expired access blocks both; reopening or reconnecting never renews it. The AppHeader connection pill shows Online or Offline; row 03 and A18 describe offline capture and expired states.

- Scan and typed code resolve the same card. Definitive no-match disables normal online save, presents A24. Registration belongs to WO-app-6 (M2): omit A24’s “Register this customer” link in M1 until `/attendant/register` exists. Never link to an unavailable route. Timeout is retryable, never not-found. Changing customer must not retain an incorrect resolved identity. (F03/F05.)
- Product/unit comes from assignment. Liquid Bought into is Vehicle, Keg, Three-wheeler or Bike; customer category never changes. Amount is default; only chosen value is editable. Switching mode clears typed value and derived display. New liquid sale clears medium, customer, entry and photo while retaining account/pump. (Sale note; connected flow hi-fi section.)
- Amount preserves exact entered spend and derives display quantity; quantity multiplies by captured rate and rounds once per configured policy. Reject more than two money decimals. Quantity precision is configured, sample PMS 3 is not policy. Capture price/version at start, preserve through in-progress changes; never rebuild spend from rounded display. Missing rate/assignment prevents valid save; do not substitute fixtures. (F04; I-29.)
- Require fresh live camera photo with preview/retake, no file/gallery picker. Keep form on camera denial, unreadable capture or storage failure. Disable repeat submission while saving; one operation ID across retries. Atomic durable local save precedes pending display. Server details+validated-photo acceptance and all eligibility checks precede A04; otherwise pending/held routes in row 03. (I-22–I-26.)
- Record next sale clears form only, never prior durable record; no per-sale logout. Receipt order: customer/card, original seller/ID, product/pump, medium, basis, quantity, captured rate, total, photo receipt.

## Copy

- “Switching clears the typed value.”; “Scan or enter a card to begin.”
- “No customer has card A7K3M9X. Check the printed code, or scan the QR.” (fixture code substituted dynamically).
- “Resolve the customer to continue.”; “Take meter photo”; “Show amount and quantity clearly”; “Retake”.
- “Save sale”; “Counts toward loyalty after the details and photo sync.”
- “Sale synced”; “Details and photo received. Added to Amina Bello's loyalty total.” (dynamic customer).
- “About 20.000 litres”, “₦1,000.00 / litre”, “₦20,000.00” illustrate configured fixture formatting; do not hard-code rates.

## Contracts needed

- **Session**: account ID, display attendant ID, name, username, station/pump/product IDs and labels, unit, current assignment version, last successful online sign-in instant, offline expiry instant and current access status. Credentials are transient sign-in input and never queued/cached/logged.
- **PriceSnapshot**: station/product ID, integer-kobo rate, currency code, price/configuration version, quantity precision, activation instant and saved-at metadata. The captured snapshot is preserved with each sale.
- **Lookup**: normalized printed code (trim, uppercase; no fuzzy match), resolved customer ID/name/fixed category/card status, definitive not-found distinct from retryable failure. Offline minimal lookup cache contains no bulk phone list.
- **OriginalSale + OutboxRow**: operation UUID, card reference, optional resolved customer, original assignment and identity snapshot, basis (amount/quantity), entered/derived exact values, unit, captured rate/price version/precision, capture instant, evidence reference/digest. Save details plus photo blob in one account-partitioned local transaction before showing saved. Wire details remain subject to server validation.
- **SaleStatus (WO-app-3)**: operation ID/server sale ID, first durable receipt instant, validated evidence state, accepted/held/cancelled/pending outcome, explicit credit outcome and reason. Connection alone or client upload success never implies accepted credit.

## Open questions and boundaries

- The merged M1 contract resolves transport names. Phone acceptance waits until WO-core-3 merges; automation may use contract-shaped intercepted responses. No new product decision is needed.
- Meter precision/halfway rounding and trustworthy capture timing remain configured/proposed as recorded in decisions; this brief settles none of them. No new product decision is required to draft these reversible docs. Missing implementation-specific failure copy must follow existing Notice/TextField patterns and be reviewed in its implementation work order.
- Added boards are approved (P-16); use repo overrides for routes, 48px phone targets, vendoring and Linear questions. No feature flags for Q-520.

Implementation copy deviation: A26 lockout count/unlock policy is not implied by M1 invalid_credentials; show the generic wrong-details message and server-provided retryable states. Quantity display uses the shared formatter (WHR-45 tracks fixed trailing-zero parity).
