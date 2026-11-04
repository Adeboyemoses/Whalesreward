# Attendant row 06: Cooking gas sale

Boards: A15-GasSale, A16-GasSynced  
Feature: F04–F05 · Invariants: I-04, I-14, I-22–I-30 · Work order: WO-app-0 (WHR-33)

Decision note: `product-docs/04 UI Design/Attendant Mobile/Attendant Connected Flow Notes.md` (including Hi-fi flow — 4 November 2026); also `Attendant Connected Flow Notes.md` and F&R named feature sections. HTML and PNG for every named board inspected 4 November 2026. Repository brief contains build requirements, not copied source documents.

## Build constraints

Use the vendored design system at `src/styles/design-system/`, `wr-root` at surface root, static client shells (T-12), self-hosted fonts including latin-ext, and typed `src/ui` wrappers. No runtime import from product-docs. Reference widths: 390px and 360px minimum; sticky actions must remain above navigation and keyboard. Real buttons/links, labels, aria-pressed on segments, aria-current on nav, aria-invalid with aria-describedby on errors, accessible icon labels and visible focus. Status always includes text. Dates use Africa/Lagos; money and quantity formatting uses shared exact helpers, never binary floats. Sample names, prices, counts and times are fixtures only.

## Contract status

All names below are proposed **TODO-CONTRACT**, not approved exports or endpoints. Reconcile against `docs/engineering/contracts/m1.md` from WO-spec-1 when it merges, before implementing. No transport paths are invented by this brief. Money/rates travel as integer-kobo strings plus currency; quantities are decimal strings plus explicit unit; instants are ISO strings; IDs are UUIDs distinct from display codes. Server derives authenticated identity, assignment, receipt time, eligibility and credit.

## Board map

Parenthetical state descriptions in screens.json are annotations, not literal URL segments. Sale IDs/local IDs are route parameters.

| Board | Route | Components (src/ui) | Reads (contract) | Writes (contract) | States | Permission |
|---|---|---|---|---|---|---|
| A15-GasSale | `/attendant/sale` | AppHeader, TextField, SegmentedControl, PhotoCapture, Button, BottomNav | TODO-CONTRACT AttendantSession, ProductPrice, CardLookup | TODO-CONTRACT CapturedSale | gas assignment; Amount/Kilograms; fixed Cylinder; ready; invalid input; camera/storage failure; saving/offline pending | originating attendant session/access; server checks each protected request |
| A16-GasSynced | `/attendant/sale/:saleId/recorded` | AppHeader, ResultBlock, KeyValueList, Notice, Button, BottomNav | TODO-CONTRACT SaleAcceptance | none | server accepted and credited; next sale | originating attendant session/access; server checks each protected request |

## Behaviour

- Same sale page as row 02, driven by authenticated pump assignment; never a product switch or liquid medium picker. Gas sets Cylinder read-only without a selection tap; expose value text to assistive technology even if using disabled input. (Connected Flow cooking-gas branch; F04.)
- Amount default and Kilograms alternate; switching clears typed value. Preserve exact entered amount or quantity; use product-configured precision and captured per-kilogram rate. Sample gas precision 2 and rate 1500.00 are fixtures. Customer category remains fixed even for a Car owner buying gas. (I-14/I-29.)
- Use all camera, validation, storage and acceptance rules from row 02 and pending/hold handling from row 03. Fresh photo mandatory; no gallery. Quantity and litres never combined. Record next sale clears customer/entry/photo and resets Amount but retains Cylinder, gas pump, unit and account. (Connected Flow branch.)

## Copy

- “Amount (₦)”, “Kilograms”, “Cylinder”.
- “Cooking gas is always sold into a cylinder. The customer's category stays Car owner.” (dynamic category).
- Fixture: “About 10.00 kg”, “₦1,500.00 / kg”, “₦15,000.00”.
- “Sale synced”; details-and-photo/loyalty consequence as row 02. Use kilograms spelled out in labels, kg where board abbreviates units.

## Contracts needed

- **TODO-CONTRACT AttendantSession**: account ID, display attendant ID, name, username, station/pump/product IDs and labels, unit, current assignment version, last successful online sign-in instant, offline expiry instant and current access status. Credentials are transient sign-in input and never queued/cached/logged.
- **TODO-CONTRACT ProductPrice**: station/product ID, integer-kobo rate, currency code, price/configuration version, quantity precision, activation instant and saved-at metadata. The captured snapshot is preserved with each sale.
- **TODO-CONTRACT CardLookup**: normalized printed code (trim, uppercase; no fuzzy match), resolved customer ID/name/fixed category/card status, definitive not-found distinct from retryable failure. Offline minimal lookup cache contains no bulk phone list.
- **TODO-CONTRACT CapturedSale**: operation UUID, card reference, optional resolved customer, original assignment and identity snapshot, basis (amount/quantity), entered/derived exact values, unit, captured rate/price version/precision, capture instant, evidence reference/digest. Save details plus photo blob in one account-partitioned local transaction before showing saved. Wire details remain subject to server validation.
- **TODO-CONTRACT SaleAcceptance**: operation ID/server sale ID, first durable receipt instant, validated evidence state, accepted/held/cancelled/pending outcome, explicit credit outcome and reason. Connection alone or client upload success never implies accepted credit.

## Open questions and boundaries

- WO-spec-1 owns final contract names/fields. Default: keep TODO-CONTRACT until its M1 document merges; do not ship guessed endpoint contracts.
- Meter precision/halfway rounding and trustworthy capture timing remain configured/proposed as recorded in decisions; this brief settles none of them. No new product decision is required to draft these reversible docs. Missing implementation-specific failure copy must follow existing Notice/TextField patterns and be reviewed in its implementation work order.
- Added boards are approved (P-16); use repo overrides for routes, 48px phone targets, vendoring and Linear questions. No feature flags for Q-520.
