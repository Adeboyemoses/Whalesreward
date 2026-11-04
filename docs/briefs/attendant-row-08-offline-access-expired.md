# Attendant row 08: Offline access expired

Boards: A18-OfflineExpired  
Feature: F01/F05 · Invariants: I-02–I-03, I-06 · Work order: WO-app-0 (WHR-33)

Decision note: `product-docs/04 UI Design/Attendant Mobile/Sign In and Handover Screen Decisions.md` (including Hi-fi flow — 4 November 2026); also `Attendant Connected Flow Notes.md` and F&R named feature sections. HTML and PNG for every named board inspected 4 November 2026. Repository brief contains build requirements, not copied source documents.

## Build constraints

Use the vendored design system at `src/styles/design-system/`, `wr-root` at surface root, static client shells (T-12), self-hosted fonts including latin-ext, and typed `src/ui` wrappers. No runtime import from product-docs. Reference widths: 390px and 360px minimum; sticky actions must remain above navigation and keyboard. Real buttons/links, labels, aria-pressed on segments, aria-current on nav, aria-invalid with aria-describedby on errors, accessible icon labels and visible focus. Status always includes text. Dates use Africa/Lagos; money and quantity formatting uses shared exact helpers, never binary floats. Sample names, prices, counts and times are fixtures only.

## Contract status

All names below are proposed **TODO-CONTRACT**, not approved exports or endpoints. Reconcile against `docs/engineering/contracts/m1.md` from WO-spec-1 when it merges, before implementing. No transport paths are invented by this brief. Money/rates travel as integer-kobo strings plus currency; quantities are decimal strings plus explicit unit; instants are ISO strings; IDs are UUIDs distinct from display codes. Server derives authenticated identity, assignment, receipt time, eligibility and credit.

## Board map

Parenthetical state descriptions in screens.json are annotations, not literal URL segments. Sale IDs/local IDs are route parameters.

| Board | Route | Components (src/ui) | Reads (contract) | Writes (contract) | States | Permission |
|---|---|---|---|---|---|---|
| A18-OfflineExpired | `/attendant/access-expired` | AppHeader, ResultBlock, KeyValueList, Notice, Button | TODO-CONTRACT AttendantSession, OwnQueueSummary | none | exact 24-hour expiry; offline disabled continue; online continue; reconnect without renewal; same-account sign-in succeeds; failed/different-account sign-in preserves original partition | originating attendant session/access; server checks each protected request |

## Behaviour

- At exactly 24 hours from last successful online sign-in pause new capture and uploads; keep pending records/photos under original account. Sign-in anchor survives restart; neither reopening nor reconnecting starts a new window. Clock rollback/restart handling must not renew access; WO-app-3 validates it, without inventing trusted-time policy here. (F01 confirmed offline-use window.)
- A18 has no authenticated bottom nav. Show original name/username/ID/assignment, last sign-in, expiry and own preserved count; this view does not grant another account queue access. Continue to sign-in disabled offline with reason, enabled online to /attendant/sign-in. It does not itself renew access. (Sign In note offline expiry.)
- Only fresh successful online sign-in with original account resumes its queue under normal validation. A different account can sign in under ordinary rules but gets none of this queue. Failed auth preserves it. Recovery is separately authorized future row 09, not an unlock or permission implicit in this screen.

## Copy

- “Offline access expired”; “Your pending uploads remain on this phone.”
- “Recording paused”; “Reconnect and sign in with the same account to continue.”
- “Continue to sign-in”; “Connect to the internet to sign in.”
- “Uploads are paused. Sign in online as grace.okon to resume.” (dynamic username).
- Full production dates use `21 Oct 2026 · 10:42 AM` in Africa/Lagos; abbreviated board dates are fixture layout, not an invented timezone.

## Contracts needed

- **TODO-CONTRACT AttendantSession**: account ID, display attendant ID, name, username, station/pump/product IDs and labels, unit, current assignment version, last successful online sign-in instant, offline expiry instant and current access status. Credentials are transient sign-in input and never queued/cached/logged.
- **TODO-CONTRACT ProductPrice**: station/product ID, integer-kobo rate, currency code, price/configuration version, quantity precision, activation instant and saved-at metadata. The captured snapshot is preserved with each sale.
- **TODO-CONTRACT OwnQueueSummary**: originating-account preserved sale/photo count and original assignment labels; no exposure across ordinary accounts.
- **TODO-CONTRACT SignIn**: online auth result establishes a new trusted sign-in anchor only on success; access failure never clears queue.

## Open questions and boundaries

- WO-spec-1 owns final contract names/fields. Default: keep TODO-CONTRACT until its M1 document merges; do not ship guessed endpoint contracts.
- Meter precision/halfway rounding and trustworthy capture timing remain configured/proposed as recorded in decisions; this brief settles none of them. No new product decision is required to draft these reversible docs. Missing implementation-specific failure copy must follow existing Notice/TextField patterns and be reviewed in its implementation work order.
- Added boards are approved (P-16); use repo overrides for routes, 48px phone targets, vendoring and Linear questions. No feature flags for Q-520.
