# Admin row 14: Settings
Boards: B07, T01, T03, T02, T04   Feature: F11   Invariants: I-07, I-09, I-41, I-45, I-51
Decision note: product-docs/04 UI Design/Admin Portal/Admin Settings Decisions.md

| Board | Route | Components (src/ui) | Reads (contract) | Writes (contract) | States | Permission |
|---|---|---|---|---|---|---|
| B07 | /admin/settings | existing admin shell, Notice, KeyValueList, DataTable | Settings, Page<SettingsChange> | none | loading, denied, error/retry, null/configured, empty/history, more history | settings |
| T01/T03 | /admin/settings/giveaway and /admin/settings/giveaway/confirm | sheet, notice, key values | Settings.timing | giveaway review/confirm (P-28) | no campaign, Owner create, pre-start edit, non-Owner read-only, start/snapshot/policy locked, review, retry, success, loading/denied/error | settings |
| T02 | /admin/settings/retention | sheet, TextField, Button, Notice | Settings.retention | side-effect-free retention review | editing, invalid days/reason, busy, no_change, version_conflict, error | settings |
| T04 | /admin/settings/retention/confirm | comparison table, key values, notice, buttons | SettingsReview | retention confirm | reviewed, keep editing, cancel, confirming, uncertain/retry same operation, review_stale, version_conflict, success | settings |

## Behaviour
- Consume existing WO-core-14 routes and strict shared schemas without changing server or contract code.
- Null values remain unconfigured. Zero grace is valid. Date displays use Africa/Lagos. Upload deadline comes from the server.
- P-28 supersedes WHR-55: only live role.isOwner plus settings permission may create/edit. Server timingLocked and timingPolicyVersion control actions, never browser time. Collect launch/start/cutoff, explicit timezone, whole grace (zero valid), and required reason; no sample defaults. Review compares every input and server-derived deadline, exact calendar/offset, reason and actor. Unsaved campaign ID is null; receipt supplies saved ID.
- Retention uses positive whole days or null, required trimmed reason, explicit server review then confirmation bound to reviewed versions and digest.
- Confirmation retries preserve the operation and payload. Stale/conflicting reviews require a fresh explicit review. Cancel and Keep editing write nothing.
- History uses server newest-first ordering with actor, when, reason, before/after and pagination.
- No sensitive settings or operation state in browser persistent storage. Existing session and no-store API conventions apply.

## Copy
- Explain Owner-only, campaign-started, saved-result and policy-unconfigured states separately.
- “Photos are never deleted automatically.” Saving retention records intent only.
- “Not set” for null; “Not configured” for policy. No board sample dates, grace duration or retention days.
- Board conflicts: P-28 adds Owner setup, launch/start/timezone and server lock states; stored-copy label derived from storedCopyPolicy, never assumed Original + compressed; launch/start added for contract completeness; no claim uploads alone qualify sales.

## Contracts needed
- Existing src/shared/contracts/settings.ts: Settings, SettingsReview, SettingsChange, strict retention proposal and confirm schemas; docs/engineering/contracts/m4.md settings section.

## Open questions
- None. P-28 and merged WO-core-14b settle timing setup; actual values remain Owner-entered.

## WHR-151 implementation plan
1. Extend strict client review/confirm validation and freeze exact giveaway retry bodies separately from retention.
2. Add memory-only session-epoch drafts, Owner create/edit/review and server-derived read-only/lock states; history shows creation and all timing changes.
3. Verify malformed responses, authority changes, uncertain retry/navigation, stale reviews and timezones with unit and real-stack browser tests; independent fidelity at 1440/390/360.
4. Run final gates, independent code/security/integrity review, evidence validation, staging PR and green merge.
