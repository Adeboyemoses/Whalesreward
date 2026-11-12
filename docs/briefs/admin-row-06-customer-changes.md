# Admin row 6: Customer account changes

Boards: C02-PhoneChange, C03-CardReplacement, C04-RecoveryReview, C05-AccountChangeApplied. Feature: F08. Invariants: I-07, I-09, I-15, I-19, I-21, I-21a, I-41, I-49.
Decision notes: Admin Customer Screen Decisions.md and Admin Account Recovery Decisions.md (4 November hi-fi sections). Contract: docs/engineering/contracts/m3.md, Customer phone, lost card and manager intake; M2 phone policy.

| Board | Route | Components (src/ui) | Reads | Writes | States | Permission |
|---|---|---|---|---|---|---|
| C02 | /admin/customers/:customerId/phone | PageHead, Notice, TextField, Button, KeyValueList, review sheet | profile, recovery-context | phone-change | loading, edit, review, submitting, uncertain retry, applied, offline, forbidden, validation and stale conflict | customers AND recovery |
| C03 | /admin/customers/:customerId/replace-card | PageHead, Notice, steps, TextField, Button, KeyValueList, review sheet | profile, recovery-context, challenge | card-verifications, verify, card-replacement | loading, send, delivery pending/failed, sent, resend countdown, verify, unavailable, verified, link, review, stale/expired, uncertain retry, applied, offline, forbidden, unconfigured intake offer | customers AND recovery |
| C04 | /admin/customers/:customerId/recovery | PageHead, Notice, TextField, checkbox, Button, KeyValueList | profile, recovery-context, manager-cases | manager-cases | loading, edit, review/confirm, pending, recorded, case already open, uncertain retry, offline, forbidden | actions: customers AND recovery; case reads: customers AND (recovery OR managerRecovery) |
| C05 | /admin/customers/:customerId | existing customer profile, Notice, LoyaltyCard, DataTable | profile, changes, permitted manager-cases | none | loading, receipt, history empty/error/pagination, forbidden | customers for history; actions require recovery |

## Behaviour

- Existing profile launches C02/C03; C03 links C04. Use existing session/route epoch guards and online-only mutations. Clear transient data on navigation, logout and authority change; never persist drafts, verification codes or responses in browser storage.
- Read recovery-context before each review and freeze exact reviewed customer/card versions into confirm. No active card disables normal phone/replacement paths. Server CAS remains authoritative. Freeze operation ID and body for uncertain mutation retry; never silently create another operation after a lost response.
- C02 requires physical-card attestation and reason. Normalize proposed phone with the shared helper; review masked old/new values. No OTP. Explain phone_in_use, phone_invalid, no_change, card_changed and policy errors.
- C03 issues only to registered phone; render only masked phone and allowlisted challenge metadata. Keep entered verification code solely in transient form memory and clear immediately after use, including failure. No code in fixtures, logging, URLs, storage or receipts. Verification failures use one generic message. Resend uses server resendAfter; sent never means verified. Refresh context and challenge before review; mutations use exact reviewed versions. Choose a valid seven-character card; server validates Active/unassigned/nonretired atomically. Do not require cards inventory permission.
- C04 records presence, checks and why code cannot be used; prohibit document numbers/copies, phones and secrets in notes. One open case; no final approval, account change or authorization. Display existing case when returned/available.
- C05 renders only server-confirmed receipt and paged immutable history; phones masked, actor/reason/server time present. Preserve existing profile behavior and read permissions.

## Copy and board deviations

- Exact unconfigured copy: "Lost-card replacement isn't switched on yet" plus an intake link.
- Intake outcome: "Recorded for a manager, nothing changed yet".
- Explain old card is disabled immediately, never reassigned; offline sales uploaded on it are held for replaced-card review.
- Boards show six-character demo codes; use the existing seven-character contract. Never reproduce the board's sample verification secret.
- Use "Code to the registered phone" rather than promise SMS: provider/channel is unconfigured. Never claim candidate availability or phone uniqueness before server confirmation. No inventory read is available to ordinary recovery callers.
- C04 splits reason from verificationNotes to meet the contract; it is intake only. C05 history only lists server change records; do not invent registration as an IdentityChange.
- C02/C03 review is a real interactive state. Admin responsive layout at 1440 px and phone width uses vendored wr-* classes and tokens.

## Contracts needed

Existing WO-core-10 schemas and endpoints supply CustomerRecoveryContext, IdentityChange, PhoneChallenge, ManagerCase. No server/contract changes planned. All IDs/versions come from validated server responses; code secrets bypass generic draft/retry storage.

## Open questions

None blocking. SMS provider, manager final decision and stranded-phone recovery are explicitly outside this work order.
