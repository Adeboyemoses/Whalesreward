# Attendant row 01: Sign in and account

Boards: A01-SignIn, A26-SignInError, A12-Account, A13-Handover
Feature: F01 · Invariants: I-01–I-06, I-09 · Work order: WO-app-2 (WHR-5), capture subset

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
| A01-SignIn | `/attendant/sign-in` | AppHeader, TextField, Button, Notice | Session | POST /api/attendant/sign-in | online empty/filled; submitting; unavailable network; disabled/unassigned account | online public sign-in |
| A26-SignInError | `/attendant/sign-in` | AppHeader, TextField, Button, Notice | POST /api/attendant/sign-in result | POST /api/attendant/sign-in retry | offline disabled; wrong credentials; locked account; retry after connection | online public sign-in |
| A12-Account | `/attendant/account` | AppHeader, KeyValueList, Notice, BottomNav, Button | Session, OwnQueueSummary | none | online/offline; zero/nonzero own pending count; session expired | originating attendant session/access; server checks each protected request |
| A13-Handover | `/attendant/account/hand-over` | AppHeader, Notice, Button, BottomNav | account-scoped OutboxRow summary | POST /api/attendant/sign-out, RetryOwnQueue | pending online; pending offline; uploading; upload failure; no pending; stay signed in; signed out | originating attendant session/access; server checks each protected request |

## Behaviour

- Sign-in and account switching require connectivity; server validates credentials, status and current station/pump assignment. No per-sale pump selector. Successful sign-in opens sale; password visibility is a labelled button and password is cleared after use. (F01; Sign In note.)
- Each sale keeps its originating identity and assignment. Account shows permanent ID independently of display name. Reassignment requires fresh online sign-in with the same account; existing queues keep old context. Reassignment board row 7 is outside this work order.
- Upload-first is available online; disable offline with reason. During upload failure do not claim completion or silently discard records. Re-read own pending count before logout; offer explicit sign-out-with-pending or stay signed in. With zero pending show ordinary Sign out. Logout pauses originating-account uploads; another ordinary account sees none of its records. Server logout/revocation failure must not claim confirmed server revocation. (F01; approved pending queue policy.)
- Offline session lasts exactly 24 hours from successful online sign-in, not app reopening or reconnecting; row 08 owns expiry. (I-03.)

## Copy

- “Internet is required to sign in or switch accounts.”
- “The username or password is not correct.” Keep lockout wording tied to server policy; never invent failure count or lock duration.
- “Upload, then sign out”, “Sign out with pending sales”, “Stay signed in”.
- “These sales and photos remain on this phone. They have not been added to loyalty yet.”

## Contracts needed

- **Session**: account ID, display attendant ID, name, username, station/pump/product IDs and labels, unit, current assignment version, last successful online sign-in instant, offline expiry instant and current access status. Credentials are transient sign-in input and never queued/cached/logged.
- **PriceSnapshot**: station/product ID, integer-kobo rate, currency code, price/configuration version, quantity precision, activation instant and saved-at metadata. The captured snapshot is preserved with each sale.
- **POST /api/attendant/sign-in / SignOut**: transient username/password and online result; logout result must distinguish confirmed server revocation from retryable failure.
- **account-scoped OutboxRow summary / RetryOwnQueue**: account-scoped count and per-operation upload outcome; no other account partition is exposed.

## Open questions and boundaries

- The merged M1 contract resolves transport names. Phone acceptance waits until WO-core-3 merges; automation may use contract-shaped intercepted responses. No new product decision is needed.
- Meter precision/halfway rounding and trustworthy capture timing remain configured/proposed as recorded in decisions; this brief settles none of them. No new product decision is required to draft these reversible docs. Missing implementation-specific failure copy must follow existing Notice/TextField patterns and be reviewed in its implementation work order.
- Added boards are approved (P-16); use repo overrides for routes, 48px phone targets, vendoring and Linear questions. No feature flags for Q-520.

Implementation copy deviation: A26 lockout count/unlock policy is not implied by M1 invalid_credentials; show the generic wrong-details message and server-provided retryable states. Quantity display uses the shared formatter (WHR-45 tracks fixed trailing-zero parity).
