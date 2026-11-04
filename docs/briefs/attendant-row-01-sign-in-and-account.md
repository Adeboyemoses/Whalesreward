# Attendant row 01: Sign in and account

Boards: A01-SignIn, A26-SignInError, A12-Account, A13-Handover
Feature: F01 · Invariants: I-01–I-06, I-09 · Work order: WO-app-0 (WHR-33)

Decision note: `product-docs/04 UI Design/Attendant Mobile/Sign In and Handover Screen Decisions.md` (including Hi-fi flow — 4 November 2026); also `Attendant Connected Flow Notes.md` and F&R named feature sections. HTML and PNG for every named board inspected 4 November 2026. Repository brief contains build requirements, not copied source documents.

## Build constraints

Use the vendored design system at `src/styles/design-system/`, `wr-root` at surface root, static client shells (T-12), self-hosted fonts including latin-ext, and typed `src/ui` wrappers. No runtime import from product-docs. Reference widths: 390px and 360px minimum; sticky actions must remain above navigation and keyboard. Real buttons/links, labels, aria-pressed on segments, aria-current on nav, aria-invalid with aria-describedby on errors, accessible icon labels and visible focus. Status always includes text. Dates use Africa/Lagos; money and quantity formatting uses shared exact helpers, never binary floats. Sample names, prices, counts and times are fixtures only.

## Contract status

All names below are proposed **TODO-CONTRACT**, not approved exports or endpoints. Reconcile against `docs/engineering/contracts/m1.md` from WO-spec-1 when it merges, before implementing. No transport paths are invented by this brief. Money/rates travel as integer-kobo strings plus currency; quantities are decimal strings plus explicit unit; instants are ISO strings; IDs are UUIDs distinct from display codes. Server derives authenticated identity, assignment, receipt time, eligibility and credit.

## Board map

Parenthetical state descriptions in screens.json are annotations, not literal URL segments. Sale IDs/local IDs are route parameters.

| Board | Route | Components (src/ui) | Reads (contract) | Writes (contract) | States | Permission |
|---|---|---|---|---|---|---|
| A01-SignIn | `/attendant/sign-in` | AppHeader, TextField, Button, Notice | TODO-CONTRACT AttendantSession | TODO-CONTRACT SignIn | online empty/filled; submitting; unavailable network; disabled/unassigned account | online public sign-in |
| A26-SignInError | `/attendant/sign-in` | AppHeader, TextField, Button, Notice | TODO-CONTRACT SignIn result | TODO-CONTRACT SignIn retry | offline disabled; wrong credentials; locked account; retry after connection | online public sign-in |
| A12-Account | `/attendant/account` | AppHeader, KeyValueList, Notice, BottomNav, Button | TODO-CONTRACT AttendantSession, OwnQueueSummary | none | online/offline; zero/nonzero own pending count; session expired | originating attendant session/access; server checks each protected request |
| A13-Handover | `/attendant/account/hand-over` | AppHeader, Notice, Button, BottomNav | TODO-CONTRACT OwnQueueSummary | TODO-CONTRACT SignOut, RetryOwnQueue | pending online; pending offline; uploading; upload failure; no pending; stay signed in; signed out | originating attendant session/access; server checks each protected request |

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

- **TODO-CONTRACT AttendantSession**: account ID, display attendant ID, name, username, station/pump/product IDs and labels, unit, current assignment version, last successful online sign-in instant, offline expiry instant and current access status. Credentials are transient sign-in input and never queued/cached/logged.
- **TODO-CONTRACT ProductPrice**: station/product ID, integer-kobo rate, currency code, price/configuration version, quantity precision, activation instant and saved-at metadata. The captured snapshot is preserved with each sale.
- **TODO-CONTRACT SignIn / SignOut**: transient username/password and online result; logout result must distinguish confirmed server revocation from retryable failure.
- **TODO-CONTRACT OwnQueueSummary / RetryOwnQueue**: account-scoped count and per-operation upload outcome; no other account partition is exposed.

## Open questions and boundaries

- WO-spec-1 owns final contract names/fields. Default: keep TODO-CONTRACT until its M1 document merges; do not ship guessed endpoint contracts.
- Meter precision/halfway rounding and trustworthy capture timing remain configured/proposed as recorded in decisions; this brief settles none of them. No new product decision is required to draft these reversible docs. Missing implementation-specific failure copy must follow existing Notice/TextField patterns and be reviewed in its implementation work order.
- Added boards are approved (P-16); use repo overrides for routes, 48px phone targets, vendoring and Linear questions. No feature flags for Q-520.
