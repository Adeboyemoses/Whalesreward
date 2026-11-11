# Review evidence release configuration

WHR-111 installs `review-evidence-v1`; it does not activate a deployment. Meter correction and price cancellation remain refused. Twelve protected health statuses include `reviewEvidence`; its status is diagnostic, not authority.

The only application setting added is `WHR_REVIEW_EVIDENCE_POLICY`, containing the exact strict JSON object in M3. `WHR_ENV` selects `test`, `staging`, `production`, or `local` (mapped to `development`); absent `WHR_ENV` uses `NODE_ENV`. Set an explicit environment in deployments. There are no activation defaults.

The release bytes are the UTF-8 string exported as `reviewEvidenceReleaseArtifact` in `src/server/modules/reviews/release.ts`. `reviewEvidenceReleaseDigest` in `config.ts` computes their SHA-256. The reviewed deployment must preserve these bytes. The v1 digest is `5441b61f25cbf2be012fbc8d695ae003ac7a6ff583ffd285ef4a75b2b38e9d1a`. Never hash the Markdown requirements or substitute an arbitrary digest. The evaluator registry must include price, card, date and capture.

Before staging activation, Earl must approve the concrete release digest, station ID, environment, next configuration revision and activation instant. Record his authorization reference in protected operational storage. No configuration value, fixture or caller-supplied evidence grants this approval.

An authorized operator provisions via a parameterized database transaction using the deployment's existing secured database connection, with no new public endpoint:

1. Insert `review_evidence_approval` with a new UUID `id`, `release`, `digest`, positive safe integer `revision`, `station_id`, `environment`, exact `activated_at` and `authorization_reference` identifying Earl's recorded authorization. Do not copy credentials or unrestricted messages into the reference.
2. Insert `review_evidence_configuration` with a new UUID, matching station/environment/revision, `authorization_reference`, and `configuration` containing the exact M3 object. Its active `approvalReference` is the approval UUID, and `activatedAt` matches the approved instant. Commit both rows together. The configuration insert trigger takes the same scope lock as review acceptance and rejects reused or decreasing revisions. These immutable rows are the operational audit history.
3. Set `WHR_REVIEW_EVIDENCE_POLICY` to that same JSON object through the approved deployment procedure. It must equal the latest stored scope revision. Missing rows, mismatches and future activation remain fail-closed. Confirm the protected health status using a live admin with `settings`.
4. For deactivation insert a higher configuration revision with `{state:"inactive",approvalReference:null,activatedAt:null}` and the authorization reference, then update the setting. Committing the stored revision immediately stops new decisions using the old setting. Re-activation or rollback requires another higher revision and a new immutable approval even when reusing release bytes.

Use bound SQL parameters, never concatenate operator values. No application or health path provisions an approval. Database deployment access is the trust boundary for these operational records. Runtime callers cannot insert them. Review receipts replay after current authority checks even when configuration changes; new operations use current configuration. Configuration changes do not reevaluate purchases or clear holds.

`review_evaluation` is protected append-only domain provenance, linked one-to-one to its decision. It contains policy identity, original/evaluated target, interval and lookup fallback, source snapshots and dependency edges, typed conclusions and result. It must not be exposed through general audit, attendant projections, logs or health. Retain it with immutable decision history.

The present implementation stores campaign membership in protected evaluation provenance. Existing `sync_validation.campaign_eligible` remains immutable and false for held originals; confirming an outside interval never changes that to true. Future campaign aggregation must consume the typed membership and independently enforce receipt deadlines and remaining eligibility gates. This release adds no campaign report or snapshot implementation.
