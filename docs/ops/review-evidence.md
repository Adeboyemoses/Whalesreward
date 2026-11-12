# Review evidence release configuration

WHR-111 installs `review-evidence-v1`; it does not activate a deployment. Meter correction and price cancellation remain refused. Twelve protected health statuses include `reviewEvidence`; its status is diagnostic, not authority.

The only application setting added is `WHR_REVIEW_EVIDENCE_POLICY`, containing the exact strict JSON object in M3. `WHR_ENV` selects `test`, `staging`, `production`, or `local` (mapped to `development`); absent `WHR_ENV` uses `NODE_ENV`. Set an explicit environment in deployments. There are no activation defaults.

The release bytes are the UTF-8 string exported as `reviewEvidenceReleaseArtifact` in `src/server/modules/reviews/release.ts`. `reviewEvidenceReleaseDigest` in `config.ts` computes their SHA-256. The reviewed deployment must preserve these bytes. The v1 digest is `5441b61f25cbf2be012fbc8d695ae003ac7a6ff583ffd285ef4a75b2b38e9d1a`. Never hash the Markdown requirements or substitute an arbitrary digest. The evaluator registry must include price, card, date and capture.

Before staging activation, Earl must approve the concrete release digest, station ID, environment, next configuration revision and activation instant. Record his authorization reference in protected operational storage. No configuration value, fixture or caller-supplied evidence grants this approval.

## Operator command

Run `pnpm ops:review-evidence --help` from the reviewed checkout using the pinned Node version. Earl supplies `DATABASE_URL` in his own shell through his existing secure credential workflow. The command reads it only into process memory: no dotenv loading, connection-string argument, file, log or raw database error output. Do not paste it into a command argument, authorization reference, shell history, ticket or transcript. Use the approved TLS connection with certificate verification for a managed database.

### One-time database identity (Earl only)

WHR-116 Option A requires Earl to set `whr.environment` once per database with his admin database user. This is separate from the operator command and application environment. Connect through Earl's secured PostgreSQL client workflow to the intended database and verify its identity privately. **Before changing anything**, inspect the persisted value with this query inside psql, not `SHOW` or `current_setting()`:

```sql
SELECT database.datname, entries.setting
FROM pg_catalog.pg_db_role_setting AS settings
JOIN pg_catalog.pg_database AS database ON database.oid = settings.setdatabase
CROSS JOIN LATERAL pg_catalog.unnest(settings.setconfig) AS entries(setting)
WHERE database.datname = pg_catalog.current_database()
  AND settings.setrole = 0
  AND pg_catalog.split_part(entries.setting, '=', 1) = 'whr.environment';
```

If exactly one matching value already exists, leave it unchanged. If an existing value differs, is malformed or appears more than once, stop; do not relabel the database to make a command pass. **Only when the query returns no rows**, Earl performs the one-time initial setup below inside psql for staging. For another environment, replace `staging` with exactly `development`, `test` or `production` as appropriate. The identifier is quoted from the actual connected database name; no connection string appears in the SQL.

```sql
SELECT pg_catalog.format('ALTER DATABASE %I SET whr.environment = %L', pg_catalog.current_database(), 'staging') \gexec
```

Run the same persisted-value SELECT again. Expect exactly one row with `whr.environment=staging` (or the deliberately selected environment). Database ownership/admin privileges control this setting: restrict those privileges to authorized operators. The operator command never provisions, repairs or changes the setting. No agent or test runs this setup against managed infrastructure.

Every preview and apply compares the explicit `--environment` with this exact database-level catalog entry. Missing, malformed, duplicate or mismatched entries refuse the operation. `WHR_ENV`, `NODE_ENV`, session `SET`, connection-string `options`, role settings and role-in-database settings cannot establish or override database identity. A runtime application setting still needs to match the applied policy as described below.

### Preview and apply

`--authorization` is a non-secret reference ID (1–200 letters, digits, dots, underscores or hyphens), such as the ID of an authorization held in protected operational storage. It is printed and stored in the immutable rows. Do not put the authorization message, a URL or credentials in it. The reference records Earl's approval; the CLI does not grant approval itself.

First preview activation (replace the fictional station ID, instant and reference with the specifically approved values):

```sh
pnpm ops:review-evidence activate \
  --station 019a5000-0000-7000-8000-000000000008 \
  --environment staging \
  --digest 5441b61f25cbf2be012fbc8d695ae003ac7a6ff583ffd285ef4a75b2b38e9d1a \
  --activated-at 2026-11-11T12:00:00Z \
  --authorization APPROVAL-REFERENCE
```

Dry run is the default; `--dry-run` is equivalent. It opens a read-only transaction and shows both proposed immutable rows plus the exact `WHR_REVIEW_EVIDENCE_POLICY` JSON. `recorded_at` is assigned by the database at insertion, so no preview claims its future value. The activation instant must be ISO 8601 with timezone and at most six fractional digits; future activation stays fail-closed until that instant.

After reviewing the output against Earl's approval, use the printed apply command with `--apply --expected-revision N`. The expected revision is mandatory for apply and must match the revision Earl approved. Activation inserts approval and matching configuration in one transaction. Each invocation locks the scope before computing one higher than every approval/configuration revision. A preview reserves nothing: concurrent operations may change the next revision, and apply generates fresh IDs. Apply refuses a stale expected revision without writing either row. Run a new dry run and obtain matching authorization before retrying. Always use the successful **apply** output, never the preview, for deployment.

To deactivate, preview and then apply the following command. M3 defines inactive configuration with null approval and activation instant, so deactivation appends only a higher immutable configuration row with the authorization reference; it never creates a fictitious activation approval.

```sh
pnpm ops:review-evidence deactivate \
  --station 019a5000-0000-7000-8000-000000000008 \
  --environment staging \
  --digest 5441b61f25cbf2be012fbc8d695ae003ac7a6ff583ffd285ef4a75b2b38e9d1a \
  --authorization DEACTIVATION-REFERENCE
```

For production both actions require explicit `--environment production` matching the database's recorded identity. Missing or mismatched identity refuses even dry run. The expected revision is only a comparison guard: both actions compute the next revision under the database lock and reject any mismatch. Neither action accepts an arbitrary release digest.

After successful apply:

1. Set `WHR_REVIEW_EVIDENCE_POLICY` to the exact JSON printed after `WHR_REVIEW_EVIDENCE_POLICY=` through the approved deployment procedure. The command does not set it or deploy anything.
2. Check `/api/health` while signed in as a live admin with `settings` permission. Active, matching, non-future configuration reports `reviewEvidence: configured`; inactive configuration reports `unconfigured`.
3. Keep the authorization reference and applied revision in protected operational records. If connection/commit acknowledgement fails, inspect the latest immutable rows privately before retrying: the transaction may have committed even without output. A rerun always creates another revision, never reuses one.

Committing an inactive stored revision immediately stops new decisions using the old setting. Re-activation or rollback requires another higher revision and a new immutable approval, even when reusing release bytes. This work order does not authorize running the command against staging or production.

Use bound SQL parameters, never concatenate operator values. No application or health path provisions an approval. Database deployment access is the trust boundary for these operational records. Runtime callers cannot insert them. Review receipts replay after current authority checks even when configuration changes; new operations use current configuration. Configuration changes do not reevaluate purchases or clear holds.

`review_evaluation` is protected append-only domain provenance, linked one-to-one to its decision. It contains policy identity, original/evaluated target, interval and lookup fallback, source snapshots and dependency edges, typed conclusions and result. It must not be exposed through general audit, attendant projections, logs or health. Retain it with immutable decision history.

The present implementation stores campaign membership in protected evaluation provenance. Existing `sync_validation.campaign_eligible` remains immutable and false for held originals; confirming an outside interval never changes that to true. Future campaign aggregation must consume the typed membership and independently enforce receipt deadlines and remaining eligibility gates. This release adds no campaign report or snapshot implementation.
