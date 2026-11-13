# Settings API smoke verification

WHR-26; local fictional PostgreSQL data only. UI coverage belongs to WHR-27.

1. With a full admin session holding settings permission, read settings and history. An untouched station has logical version 1, no saved version, null retention days and deletion disabled. No illustrative board values appear.
2. Review a positive retention duration with a reason and current version. Inspect the canonical before/after comparison and digest. Repeat the review; no settings version, history, success audit or receipt is created.
3. Confirm that proposal and digest with a new operation ID. Check one immutable version, typed history entry, version-2 audit and receipt. Retry the same request and observe the original result without another effect.
4. Change request content under the same operation ID and expect operation_conflict. Review again, commit another change, then confirm the stale review and expect version_conflict. Concurrent fresh confirmations must have one winner.
5. Revoke settings permission between review and confirm. Confirmation and history must deny access. A foreign station's resources must remain inaccessible.
6. Confirm giveaway timing while WHR-55 is pending and expect 409 timing_policy_unconfigured, retryable false, with no writes. Protected health reports policies.timing as unconfigured.
7. Clear retention to null through explicit review and confirm. Deletion remains false for every response. Verify preserved evidence and unchanged sections; no deletion endpoint or job is introduced.

Automated names and final gate results are posted to WHR-26 after implementation.
