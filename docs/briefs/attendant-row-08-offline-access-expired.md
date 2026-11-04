# Attendant row 08: Offline access expired

Boards: A18-OfflineExpired
Feature: F01/F05 · Invariants: I-02–I-03, I-06 · Work order: WO-app-2 (WHR-5), capture subset

Decision note: `product-docs/04 UI Design/Attendant Mobile/Sign In and Handover Screen Decisions.md` (including Hi-fi flow — 4 November 2026); also `Attendant Connected Flow Notes.md` and F&R named feature sections. HTML and PNG for every named board inspected 4 November 2026. Repository brief contains build requirements, not copied source documents.

## Build constraints

Use the vendored design system at `src/styles/design-system/`, `wr-root` at surface root, static client shells (T-12), self-hosted fonts including latin-ext, and typed `src/ui` wrappers. No runtime import from product-docs. Reference widths: 390px and 360px minimum; sticky actions must remain above navigation and keyboard. Real buttons/links, labels, aria-pressed on segments, aria-current on nav, aria-invalid with aria-describedby on errors, accessible icon labels and visible focus. Status always includes text. Dates use Africa/Lagos; money and quantity formatting uses shared exact helpers, never binary floats. Sample names, prices, counts and times are fixtures only.

## Contract status

Reconciled 4 November 2026 against `docs/engineering/contracts/m1.md`; PNG and HTML for A01/A26/A12/A13/A02/A24/A03/A27/A05/A15/A18 inspected before code. `Session`, `PriceSnapshot`, `Lookup`, `OriginalSale`, `OutboxRow` and `OfflineWindow` use that normative contract. `src/client/api.ts` is the typed HTTP boundary; WO-core-3 supplies real sign-in/session endpoints. Contract-shaped fakes are test-only. WO-app-2 ends at atomic local save; A04/A16 and upload/retry/credit states remain WO-app-3.

M1 navigation exposes Sale and Account only until Uploads/History/Register ship. Upload-first stays visibly disabled with an unavailable explanation; leave-pending and stay-signed-in work. The local receipt says the photo is saved and pending, never promises automatic delivery in this slice. `ClientState` is local UI state, never server authority.
## Board map

Parenthetical state descriptions in screens.json are annotations, not literal URL segments. Sale IDs/local IDs are route parameters.

| Board | Route | Components (src/ui) | Reads (contract) | Writes (contract) | States | Permission |
|---|---|---|---|---|---|---|
| A18-OfflineExpired | `/attendant/access-expired` | AppHeader, ResultBlock, KeyValueList, Notice, Button | Session, OwnQueueSummary | none | exact 24-hour expiry; offline disabled continue; online continue; reconnect without renewal; same-account sign-in succeeds; failed/different-account sign-in preserves original partition | originating attendant session/access; server checks each protected request |

## Behaviour

- At exactly 24 hours from last successful online sign-in pause new capture and uploads; keep pending records/photos under original account. Sign-in anchor survives restart; neither reopening nor reconnecting starts a new window. Clock rollback/restart handling must not renew access; WO-app-2 validates it, without inventing trusted-time policy here. (F01 confirmed offline-use window.)
- A18 has no authenticated bottom nav. Show original name/username/ID/assignment, last sign-in, expiry and own preserved count; this view does not grant another account queue access. Continue to sign-in disabled offline with reason, enabled online to /attendant/sign-in. It does not itself renew access. (Sign In note offline expiry.)
- Only fresh successful online sign-in with original account resumes its queue under normal validation. A different account can sign in under ordinary rules but gets none of this queue. Failed auth preserves it. Recovery is separately authorized future row 09, not an unlock or permission implicit in this screen.

## Copy

- “Offline access expired”; “Your pending uploads remain on this phone.”
- “Recording paused”; “Reconnect and sign in with the same account to continue.”
- “Continue to sign-in”; “Connect to the internet to sign in.”
- “Uploads are paused. Sign in online as grace.okon to resume.” (dynamic username).
- Full production dates use `21 Oct 2026 · 10:42 AM` in Africa/Lagos; abbreviated board dates are fixture layout, not an invented timezone.

## Contracts needed

- **Session**: account ID, display attendant ID, name, username, station/pump/product IDs and labels, unit, current assignment version, last successful online sign-in instant, offline expiry instant and current access status. Credentials are transient sign-in input and never queued/cached/logged.
- **PriceSnapshot**: station/product ID, integer-kobo rate, currency code, price/configuration version, quantity precision, activation instant and saved-at metadata. The captured snapshot is preserved with each sale.
- **account-scoped OutboxRow summary**: originating-account preserved sale/photo count and original assignment labels; no exposure across ordinary accounts.
- **POST /api/attendant/sign-in**: online auth result establishes a new trusted sign-in anchor only on success; access failure never clears queue.

## Open questions and boundaries

- The merged M1 contract resolves transport names. Phone acceptance waits until WO-core-3 merges; automation may use contract-shaped intercepted responses. No new product decision is needed.
- Meter precision/halfway rounding and trustworthy capture timing remain configured/proposed as recorded in decisions; this brief settles none of them. No new product decision is required to draft these reversible docs. Missing implementation-specific failure copy must follow existing Notice/TextField patterns and be reviewed in its implementation work order.
- Added boards are approved (P-16); use repo overrides for routes, 48px phone targets, vendoring and Linear questions. No feature flags for Q-520.

Implementation copy deviation: A26 lockout count/unlock policy is not implied by M1 invalid_credentials; show the generic wrong-details message and server-provided retryable states. Quantity display uses the shared formatter (WHR-45 tracks fixed trailing-zero parity).
