# Admin row 14: Settings
Boards: B07, T01, T03, T02, T04   Feature: F11   Invariants: I-07, I-11, I-45, I-51
Decision note: product-docs/04 UI Design/Admin Portal/Admin Settings Decisions.md

| Board | Route | Components (src/ui) | Reads (contract) | Writes (contract) | States | Permission |
|---|---|---|---|---|---|---|
| B07 | /admin/settings | existing admin shell, Notice, KeyValueList, DataTable | Settings, Page<SettingsChange> | none | loading, denied, error/retry, null/configured, empty/history, more history | settings |
| T01/T03 | /admin/settings/giveaway | sheet, notice, key values | Settings.timing | none until WHR-55 | locked, read-only values, loading/denied/error | settings |
| T02 | /admin/settings/retention | sheet, TextField, Button, Notice | Settings.retention | side-effect-free retention review | editing, invalid days/reason, busy, no_change, version_conflict, error | settings |
| T04 | /admin/settings/retention | comparison table, key values, notice, buttons | SettingsReview | retention confirm | reviewed, keep editing, cancel, confirming, uncertain/retry same operation, review_stale, version_conflict, success | settings |

## Behaviour
- Consume existing WO-core-14 routes and strict shared schemas without changing server or contract code.
- Null values remain unconfigured. Zero grace is valid. Date displays use Africa/Lagos. Upload deadline comes from the server.
- Timing remains read-only until WHR-55, including direct URLs and review state URLs. Do not send fabricated proposals to probe policy.
- Retention uses positive whole days or null, required trimmed reason, explicit server review then confirmation bound to reviewed versions and digest.
- Confirmation retries preserve the operation and payload. Stale/conflicting reviews require a fresh explicit review. Cancel and Keep editing write nothing.
- History uses server newest-first ordering with actor, when, reason, before/after and pagination.
- No sensitive settings or operation state in browser persistent storage. Existing session and no-store API conventions apply.

## Copy
- “Campaign dates can't be changed until Whales approves the timing rules”
- “Photos are never deleted automatically.” Saving retention records intent only.
- “Not set” for null; “Not configured” for policy. No board sample dates, grace duration or retention days.
- Board conflicts: timing editor/review locked by contract and Earl; stored-copy label derived from storedCopyPolicy, never assumed Original + compressed; launch/start added for contract completeness; no claim uploads alone qualify sales.

## Contracts needed
- Existing src/shared/contracts/settings.ts: Settings, SettingsReview, SettingsChange, strict retention proposal and confirm schemas; docs/engineering/contracts/m4.md settings section.

## Open questions
- None. Timing provisioning/policy is already assigned to WHR-55.
