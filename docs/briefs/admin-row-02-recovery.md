# Admin row 02: Password recovery (verified email), with the reset email

Boards: B10-PasswordRecovery, B11-RecoveryEmailSent, M02-PasswordResetEmail, B12-ResetPassword, B13-ResetLinkUnavailable   Feature: F12   Invariants: I-07, I-08, I-09, I-10, I-11, I-12, I-13
Decision note: product-docs/04 UI Design/Admin Portal/Admin Account Recovery Decisions.md (including Hi-fi flow — 4 November 2026).

| Board | Route | Components (src/ui) | Reads (contract) | Writes (contract) | States | Permission |
|---|---|---|---|---|---|---|
| B10-PasswordRecovery | /admin/forgot-password | TextField, Button, Notice, StatusPill | POST password-reset/inspect → email, expiresAt | POST password-reset-requests (Idempotency-Key), password-reset/confirm (single-use token) | Board state; loading, empty, network error, unavailable, permission denied, success; review/confirm/keep editing/cancel for writes | live full/restricted session or purpose-bound recipient token as endpoint requires |
| B11-RecoveryEmailSent | /admin/forgot-password/sent | TextField, Button, Notice, StatusPill | POST password-reset/inspect → email, expiresAt | POST password-reset-requests (Idempotency-Key), password-reset/confirm (single-use token) | Board state; loading, empty, network error, unavailable, permission denied, success; review/confirm/keep editing/cancel for writes | live full/restricted session or purpose-bound recipient token as endpoint requires |
| M02-PasswordResetEmail | email: password reset | TextField, Button, Notice, StatusPill | POST password-reset/inspect → email, expiresAt | POST password-reset-requests (Idempotency-Key), password-reset/confirm (single-use token) | Board state; loading, empty, network error, unavailable, permission denied, success; review/confirm/keep editing/cancel for writes | live full/restricted session or purpose-bound recipient token as endpoint requires |
| B12-ResetPassword | /admin/reset-password?token=… | TextField, Button, Notice, StatusPill | POST password-reset/inspect → email, expiresAt | POST password-reset-requests (Idempotency-Key), password-reset/confirm (single-use token) | Board state; loading, empty, network error, unavailable, permission denied, success; review/confirm/keep editing/cancel for writes | live full/restricted session or purpose-bound recipient token as endpoint requires |
| B13-ResetLinkUnavailable | /admin/reset-password (invalid token) | TextField, Button, Notice, StatusPill | POST password-reset/inspect → email, expiresAt | POST password-reset-requests (Idempotency-Key), password-reset/confirm (single-use token) | Board state; loading, empty, network error, unavailable, permission denied, success; review/confirm/keep editing/cancel for writes | live full/restricted session or purpose-bound recipient token as endpoint requires |

## Behaviour
- Reference: docs/engineering/contracts/m2.md admin access and users/roles tables, implemented src/shared/contracts/admin.ts and src/server/modules/admin-access/. All URLs above are under /api/admin unless complete.
- Build the approved board HTML structure and wr- classes; PNGs establish layout. Use entry split layout and Sidebar management layout. Desktop 1440 px; collapse gracefully at 390 px with 48 px phone controls. No shipped fixture fallback.
- Load live server session and permissions with no-store; first-password sessions cannot access management. UI grants only affect presentation; server authorizes every call. Refresh on navigation, focus and permission/stale errors; clear prior identity data/drafts. Never persist admin queries or secrets to storage or service-worker cache.
- Domain changes require reason, Review, explicit Confirm; Keep editing retains the in-memory draft, Cancel clears it. Use expected user/role versions exactly as reviewed. New conflict requires reread and new review/operation ID; do not auto-retry an uncertain mutation as a new operation. Preserve operation identity for identical retries.
- New users require unique username, email, temporary password, role and reason. Password has 12-character engineering minimum, cleared on completion/cancel/navigation; review never reveals it. New accounts remain Unverified until explicit recipient confirmation. Null legacy email displays No email recorded, with no send action.
- Roles start with zero grants. Use canonical 28 permissions grouped by parent view; selecting action adds parent, clearing parent clears dependents. Owner is read-only. Five sensitive grants stay separate; priceReview is an engineering Owner-default proposal. Counts and grants come from API, never fictional presets.
- Tokens enter short-lived page memory and are immediately removed from URL/history; inspect does not consume. No third-party assets or analytics; no-referrer and no-store landing pages. Verify explicitly, reset returns to sign-in without automatic session. Sign-out result appears only after successful server revocation; a failed logout locks local UI with revocation pending.

## Copy
- Use exact board headings and action labels: Sign in; Set your password; Save and continue; Sign out?; You are signed out; Reset your password; Check your email; Choose a new password; This link is unavailable; Verify your email; Email verified; This verification link is unavailable; Review access change; Confirm change; Keep editing; Cancel.
- Explain permission_denied, delegation_denied, last_owner, protected_owner and version_conflict in plain words; never swallow the response or show success.
- Intentional contract overrides: B14 says sent but only queued intent is known; show Verification link queued until actual delivery known. M01/M02 are existing server templates, inspect delivered output; do not reimplement them. Token expiry comes from inspect/configuration, never hardcode board placeholders. B12 password history wording covers current-password difference only. H07 is a permission-view reference; reports APIs/content are later scope, so do not invent reporting data or build reports here.
- Full email may appear in authorized account/token-holder UI; never logs, analytics, URLs or browser storage. All dates use Africa/Lagos and design-system formatting.

## Contracts needed
Existing M2 admin contracts suffice; inspect actual response shapes. Use shared permission catalogue/dependencies, roleSummarySchema/adminUserSchema and typed AdminSession. No server or schema change planned.

## Open questions
None blocking. D06 values remain centrally configured engineering proposals; no new policy, email provider or cloud change is authorized.
