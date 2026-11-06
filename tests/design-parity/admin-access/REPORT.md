# Admin access design fidelity — WO-app-4

Independent test-engineer inspection, 6 November 2026. Implemented source and test head: `c738a86` (includes frontend FIX `16c9370`). The frontend builder did not perform this sign-off. Each source PNG and HTML was inspected against the built screenshot; the original sources remain read-only outside the repository.

Browser: local Linux Chromium, Node 26.12.0, cached `whr-upload-browser:lean` image; real local PostgreSQL and Mailpit. Fresh fixture database: `whr_admin_browser_final4`. Native host Chromium cannot launch in the session sandbox. This is browser verification, not Earl's staging acceptance or a physical-phone test.

## Scope and interpretation

The 24 requested boards are accounted for below. Screenshot names are `<board>.built.png` under [screenshots](screenshots/). Desktop pages use 1440 CSS px at device scale 2 and each source board's height; delivered email previews use their source width of 760 CSS px. Mobile checks use 390 × 844. Full-page screenshots include natural document overflow vertically. These are structural/state comparisons, not a pixel-equality assertion.

The live stack deliberately uses newly generated fictional identities, opaque IDs and server dates instead of shipping the board's samples. Password fields are empty in every capture, verified by an assertion before capture. Tests disable retained traces, video and automatic failure screenshots. The M01/M02 captures render a sanitized clone of the actual Mailpit HTML with **all token text and token hrefs replaced by `[redacted]`**; actual received links exist only in short-lived test memory. B16 is captured only after the real recipient confirmation returns Email verified. No mail HTML, passwords or actual link tokens are committed.

Management navigation shows only this work order's delivered access sections, filtered using live server grants. The full twelve-section Owner sidebar in the boards is a future-module reference. Reference Operations/Read-only roles are not automatically provisioned by the API, so role names/counts and access-history lengths differ. No reporting figures or preset authority were fabricated to match a screenshot.

## Board comparison

| Board | Match | Differences and evidence | Severity |
|---|---|---|---|
| B01-AdminSignIn | Structural pass | Split entry, brand, labelled credentials, reveal control, recovery row and explanatory notice. Empty credentials in evidence. | note |
| B08-FirstPassword | Structural/state pass | Restricted-session notice and password validation; restricted response supplies identity without inventing extra role data. Temporary credentials never shown. | note |
| B09-SignOut | Structural/state pass | Identity card, inline Sign out / Stay signed in buttons and device-session explanation. Server-confirmed sign-out tested. Live identity detail is more compact than sample. | note |
| B18-SignedOut | Structural/state pass | Result icon, cleared-draft explanation and full-width primary Sign in again. Result follows successful revocation only. | note |
| B10-PasswordRecovery | Structural/state pass | Email request, generic-response explanation and return action. Account existence is never revealed. | note |
| B11-RecoveryEmailSent | Structural/state pass | Info result, Check your email, latest-link card and secondary new-link action. Generic wording follows API contract. | note |
| M02-PasswordResetEmail | Inherited template; not exact | Actual delivered core template sanitized before capture. Generic body omits sample greeting/account/station details; paragraph order and spacing/header differ; preview From/To/Subject wrapper is not part of delivered HTML. Configured expiry and fragment links replace placeholders intentionally. | WHR-70 (lane:core) |
| B12-ResetPassword | Structural/state pass | Account card, different-password validation, security/audit/re-sign-in explanation. New replacement link works in same tab after old-link refusal; reset does not sign in. | note |
| B13-ResetLinkUnavailable | Structural/state pass | Warning result and primary new-link action. Replaced and consumed reset links tested. | note |
| B14-VerificationSent | Contract-adapted pass | Account and explanatory columns. Says queued, not delivered; direct reload cannot prove prior enqueue. Address remains unverified until recipient confirmation. | intentional contract override |
| M01-VerificationEmail | Inherited template; not exact | Actual delivered core template sanitized before capture. Generic adding-admin/address text replaces named greeting/actor/station copy; header, line spacing, paragraph order and preview envelope differ. Explicit confirmation and single-use semantics preserved. | WHR-70 (lane:core) |
| B15-EmailVerification | Structural/state pass | Address card, explicit recipient action, opening-does-not-verify guidance. Inspect verified to have no mutation. | note |
| B16-VerificationComplete | Structural/state pass | Success result and primary Return to sign in; no automatic authentication. Captured after real database confirmation. | note |
| B17-VerificationExpired | Structural/state pass | Warning result, resend guidance and primary Return to sign in. Used-token state tested; token expiry enforcement also belongs to existing core integration suite. | note |
| H01-Users | Structural pass | Segmented access tabs, live table/search and access history. Fixture count/data differ; additional bounded search is usable. History details have known P2 presentation limits. | note / WHR-69 |
| H02-CreateUser | Structural/state pass | 1.3:1 form/access summary, required help text, reason, reveal control and inline review/cancel. Screenshot precedes entering the temporary password. | note |
| H09-ReviewUserChange | Structural/state pass | No-write-before-confirm, hidden password summary, identity/role/status/reason and inline confirmation actions. Permanent-ID placeholder and permitted-action count are omitted from this compact review presentation. | WHR-69 (nonblocking) |
| H03-ManageUser | Structural/state pass | Verified address, role/status edits, access summary and history. Last-sign-in field is omitted from the compact record presentation. Server refusals tested separately. | WHR-69 (nonblocking) |
| H04-UnverifiedUser | Structural/state pass | Unverified status and send-verification action. Cannot manually verify or recover using the unverified address. Same compact record limitation as H03. | WHR-69 (nonblocking) |
| H05-Roles | Structural/state pass | Roles table, counts/grants and protected Owner. Only actually provisioned roles shown; no production preset fabrication. Bounded picker/history limitations tracked separately. | note / WHR-69 |
| H06-CreateRole | Structural/state pass | Empty custom grants, canonical 28 grouped permissions, dependencies, six Owner-default badges including proposed priceReview, reason and explicit review. Parent/action selection tested. | note |
| H10-ReviewRoleChange | Structural/state pass | Frozen permission set, added/removed permissions and affected-user count before confirmation; review asserts View reports / Export reports and one affected user. Inline actions. History presentation differs. | note / WHR-69 |
| H08-SensitivePermissions | Structural/state pass | Protected Owner and 28 checked permissions; grouped independent sensitive grants. Labels follow canonical API catalogue where older board wording differs. | intentional contract override |
| H07-RoleAccessReview | Permission reference only | Reports API/data are outside this work order, as documented in the implementation brief. Reports-only test admin receives its server grants, cannot read users or roles; no report dashboard or mock report screenshot is claimed. | scope boundary |

Remaining record-presentation and inherited-template differences above are declared nonblocking limitations, not assertions of exact visual parity. The implemented entry/management state hierarchy, controls, semantic status colours, dependency grouping and final CTA layout were checked after the builder's fidelity fixes. No unresolved authentication, authorization, token replay or confirmation-state failure remains in this test run.

## Behavioral and responsive verification

`pnpm exec playwright test --config tests/admin-access/admin-access.config.ts`: **4 passed, 0 failed, 0 skipped (31.8 seconds)** on the final captured head. Four cases cover real named sign-in and restricted first password; role/user confirmation; Mailpit verification and reset; inspect-without-mutation; consumed/replaced/new links in the same tab; Back/Forward after URL scrubbing; reset revocation; last-Owner/delegation/stale-version refusals; restricted-session sign-out; and 390 px layouts.

Mobile public pages, users list, create user, role editor and role confirmation assert no document horizontal overflow and every visible button at least 44 px high (48 px is the design target). Mobile screenshots are named `mobile-*.built.png`. This floor check does not assert every control is exactly 48 px.

The ordinary CI suite separately runs `tests/e2e/admin-access.spec.ts` against the real local API/database. It verifies first-password restrictions, role dependencies, no create before confirmation and active-session revocation. All test accounts are fictional; normal CI mail remains no-op. See [rerun instructions](../../admin-access/README.md).
