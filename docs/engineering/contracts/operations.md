# Operational endpoints

Part of WO-core-15 (WHR-28). These endpoints describe deployment readiness; they do not expose product records or establish purchase acceptance.

## GET /api/health

Public, read-only health probe for App Platform. No authentication, request body or query parameters are required. It performs a bounded `SELECT 1` database probe without reading customer or staff data.

| Result | HTTP | JSON |
|---|---|---|
| Database probe succeeds | 200 | `{ "ok": true, "version": "<deployment version>", "db": "ok" }` |
| Missing database configuration, connection/query failure or timeout | 503 | `{ "ok": false, "version": "<deployment version>", "db": "unavailable" }` |

`version` is `APP_VERSION` when supplied by deployment settings, otherwise the package version. The staging web component binds it to its source commit so Earl can compare the response with GitHub. It is a build identifier, never a credential.

Responses use `Cache-Control: no-store`. Staging responses also carry `X-Robots-Tag: noindex`. Errors never include connection strings, database hosts, exception text or stack traces. A successful probe confirms database connectivity; it does not prove that seed jobs, application workflows or storage uploads succeeded. Check deployment job results separately.

### Configuration status — WO-spec-3f / WHR-100

This amendment extends the probe above. Every response adds `fullyConfigured:boolean`. It is true only when every policy in the closed allowlist below is `configured`, including policies whose domain endpoints are not yet implemented. An unavailable evaluator reports `unconfigured`, never an omitted key or assumed success. `ok`, `db`, `version` and HTTP status retain their existing database-probe meanings. Missing policy alone returns 200 with `fullyConfigured:false`; database failure remains 503 even if all policies are configured. Do not rely on a 503 body surviving the platform edge.

Unauthenticated callers see exactly `{ok,version,db,fullyConfigured}`. They receive no policy names, individual statuses, missing-policy counts or diagnostic reasons. The same projection applies to attendants, restricted first-password/recovery sessions, invalid/expired/revoked sessions and admins without `settings`. This limits disclosure of specific security-policy gaps while keeping the deployment probe public. It supersedes WHR-99's public top-level `cardPrint` exposure: that status moves into the protected `policies` object.

Only a full, live admin session with an enabled account and role, matching current auth version and current `settings` permission receives `{ok,version,db,fullyConfigured,policies}`. Recheck authority for each response; never trust cookie claims or a caller-selected role. If authority cannot be established, return only the public projection. No query/header option, attendant cookie or recovery grant selects the protected projection. Earl can inspect the complete listing while signed into the admin portal with `settings` permission. Missing auth configuration never creates a diagnostics bypass.

```ts
type PolicyStatus = 'configured' | 'unconfigured';
type HealthPolicies = {
  auth: PolicyStatus;
  delivery: PolicyStatus;
  delegation: PolicyStatus;
  phone: PolicyStatus;
  meter: PolicyStatus;
  phoneVerification: PolicyStatus;
  recovery: PolicyStatus;
  reconciliation: PolicyStatus;
  timing: PolicyStatus;
  cardPrint: PolicyStatus;
  duplicateWindow: PolicyStatus;
  reviewEvidence: PolicyStatus;
};
```

| Policy name | Configuration gate represented |
|---|---|
| `auth` | M2 authentication/session policy and required auth configuration; `auth_policy_unconfigured` |
| `delivery` | M2 email delivery adapter and required valid configuration; `delivery_unconfigured` |
| `delegation` | M2 approved delegation policy; `delegation_policy_unconfigured` |
| `phone` | M2/M3 phone normalization and validation policy; `phone_policy_unconfigured` |
| `meter` | M3 P-26 approved active meter-reconciliation-v1 evaluator, active approved P-25 dependency and verified profiles covering supported current pump/product/precision scope; `meter_policy_unconfigured` |
| `phoneVerification` | M3 phone verification delivery, expiry and attempt policy; `phone_verification_unconfigured` |
| `recovery` | M3 recovery session/grant expiry and device-binding policy; `recovery_policy_unconfigured` |
| `reconciliation` | M4 reconciliation checklist and complete-photo receipt evidence policy; `reconciliation_policy_unconfigured` |
| `timing` | M4 P-28 recorded approved campaign-timing-v1 policy with station binding and matching installed evaluator; `timing_policy_unconfigured` |
| `cardPrint` | Valid PDF layout under the existing card print validator; `print_layout_unconfigured` |
| `duplicateWindow` | M3 P-24 valid, active duplicate window policy; missing configuration disables time-based detection only, never photo-digest detection or credit |
| `reviewEvidence` | M3 P-25 active, approved review-evidence-v1 policy with matching digest/scope and all four installed evaluators; unsupported outcomes retain explicit denials |

**Amended by WO-spec-4b / WHR-138, 14 Nov 2026.** `policies.timing` becomes configured when the immutable approved P-28 policy version `campaign-timing-v1` and station binding are recorded and its matching evaluator is installed, as specified in [M4 Settings](m4.md#policy-review-commit-and-replay). The follow-up core migration records the approved definition and binds any existing MVP station; stations created afterward receive the same binding idempotently in their bootstrap transaction. Neither path seeds campaign values; no timing environment variable or manual ops activation is required. Missing/unsupported policy, invalid binding or missing evaluator stays unconfigured. Read policy storage with bounded database access; storage failure preserves the existing 503 database semantics. Recording policy is not an effect of health or a Settings request.

Campaign values may still be null and campaign absent while timing health is configured: those are campaign readiness blockers. An Owner later supplies all values through reviewed Settings. Timing health neither approves reconciliation/complete-photo proof nor permits finalization or evidence deletion. Preserve the twelve-key allowlist, full-live-settings-admin projection and aggregate public fallback; expose no policy identity, approval source, version, digest or client values through health. This specification does not change the currently hard-coded unconfigured runtime evaluator.

**Amended by WO-spec-3k, 12 Nov 2026.** [P-26](m3.md#meter-reconciliation--p-26) defines `meter` readiness. All deployment-supported current pump/product/precision combinations need valid approved profiles; gaps or missing evaluators/dependencies report unconfigured. Health checks configuration only, not historical sale/photo sufficiency. A configured policy can still reject an older sale without full interval coverage. Specification approval does not activate runtime policy. Existing settings-only projection, aggregate public response and redaction apply; expose no profile, step, approval, version or digest. `reviewEvidence` alone never enables meter correction.

**Amended by WO-spec-3i, 11 Nov 2026.** `reviewEvidence` extends the protected closed allowlist to twelve names. Use the [M3 strict configuration and activation validator](m3.md#strict-policy-configuration-and-activation). Missing, malformed, inactive, unapproved or unsupported configuration, digest/scope mismatch or an unavailable evaluator reports `unconfigured`. All four kinds must be installed, including explicit price-cancellation denial. `configured` does not mean every outcome is enabled or every sale has sufficient evidence. WHR-50 remains independently represented by `meter`.

Health inspects configuration and evaluator availability only, never a purchase, photo or external source. Only full live admins with current `settings` permission see `policies.reviewEvidence`; public projection, authority fallback, database HTTP semantics and no-store/Vary rules remain unchanged. `fullyConfigured` includes this status. No policy identity, digest, revision, scope, source reference, threshold or failure reason is exposed. This normative addition does not itself install or activate an evaluator.

**Amended by WO-spec-3g, 11 Nov 2026.** `duplicateWindow` extends the closed allowlist to eleven names. Use M3’s DuplicateWindowPolicy validator and activation state; absent detector/evaluator means `unconfigured`. Missing window configuration makes `fullyConfigured:false` with HTTP 200 when the database probe succeeds. This advisory setting adds no domain error, hold or acceptance gate. Rule (b), validated-photo digest matching, still runs. The protected listing includes the new status; public callers still receive only the aggregate and existing probe fields.

Each status uses the same environment-aware validation and policy activation decision as its domain gate. `configured` means every required setting is present and valid and the policy is enabled for that environment; a populated variable alone is insufficient. Missing, malformed, unsupported or inactive configuration reports `unconfigured`. Explicitly permitted development/staging proposals count only in their permitted environment. No fixture, placeholder, health check or environment default approves a production policy. This work does not authorize activating the unimplemented M3/M4 gates just to make staging green.

Evaluate the allowlist from one configuration snapshot per request. Isolate each evaluator: a malformed policy marks that policy unconfigured without hiding the other results or breaking the database probe. Evaluation is bounded, read-only and causes no delivery, export, token issuance, queue mutation or provider/storage probe. `delivery_unavailable`, `storage_unavailable`, allocation exhaustion and individual failed exports are transient or resource states, not policy flags. A provider outage does not by itself change valid configuration to unconfigured; no health flag promises that an operation will succeed.

Return only the fixed names and status enum in `policies`. Never serialize policy objects, environment-variable names or values, versions, thresholds, URLs, recipient lists, credentials, parser errors or exception text. Existing deployment `version` remains the sole build identifier, not a policy value. `fullyConfigured` is the conjunction of the twelve statuses, not campaign readiness, evidence-retention approval or acceptance authority. It cannot clear holds, start deletion, authorize recovery, credit purchases or finalize a giveaway. Domain gates still run independently on every operation.

Both projections use `Cache-Control: no-store` and `Vary: Cookie`; browser, intermediary and service-worker caches must not retain either response. Keep the existing staging noindex header. Projection and redaction also apply to database-failure responses; failure must never expose a protected listing to an unauthorized caller. The health endpoint keeps its direct JSON shape, outside M1's domain envelope; the ten remapped domain errors keep their existing envelope.

Required implementation verification: all twelve configured; each missing/invalid/inactive policy in turn; absent evaluator; aggregate equality; permitted staging versus production gates; public, attendant, first-password, recovery, invalid/revoked and insufficient-permission projections; permission revoked before response; no values in successful or failed responses; database failure with each projection; no caching or side effects. Test that `cardPrint` is absent publicly and present only inside authorized `policies`. Separately test each domain remap, its unchanged message/envelope and fail-closed state. Specification review does not claim these runtime tests have passed.
