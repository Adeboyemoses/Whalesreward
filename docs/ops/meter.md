# Meter reconciliation profiles and activation

WHR-126 installs P-26 `meter-reconciliation-v1`. It stays unavailable until Q-559 supplies verified meter measurements and Earl approves the exact profile set and deployment activation. This repository provides no real profiles or production defaults. `reviewEvidence` alone does not enable meter correction.

Run `pnpm ops:meter --help` from the reviewed checkout with the pinned Node version. Earl supplies `DATABASE_URL` in his own shell through his secure credential workflow; never put it in arguments, files, output or tickets. Use certificate-verified TLS for a managed database. The command uses the owner-written database comment identity described below and in [the review-evidence runbook](review-evidence.md#one-time-database-identity-earl-only). It does not create or repair that identity. Both preview and apply require an explicit matching environment, including production.

## One-time database identity (Earl only)

Both operator commands use the exact current-database comment `whr.environment=<environment>`, not a custom PostgreSQL parameter. The database owner, including a non-superuser managed PostgreSQL owner such as `doadmin`, can set the comment without superuser parameter privileges. Connect to the intended database using Earl's secured psql workflow and privately verify its identity. **Before changing anything**, read back the comment:

```sql
SELECT database.datname,
       pg_catalog.shobj_description(database.oid, 'pg_database') AS environment_identity
FROM pg_catalog.pg_database AS database
WHERE database.datname = pg_catalog.current_database();
```

Leave an exact matching label unchanged. Stop on any existing non-null wrong, malformed or extra-text comment; do not overwrite it to make a command pass. This identity uses the whole database comment, replacing any description, and must contain no secrets. **Only when the query returns one row with a null comment**, Earl performs the one-time staging setup inside psql as database owner:

```sql
SELECT pg_catalog.format('COMMENT ON DATABASE %I IS %L', pg_catalog.current_database(), 'whr.environment=staging') \gexec
```

For another deliberately selected environment, replace `staging` with exactly `development`, `test` or `production`. Run the read-back query again and expect exactly `whr.environment=staging` (or that selected environment). Restrict database ownership and superuser authority to authorized operators. Missing, wrong or extra-text labels refuse both preview and apply. Session `SET`, startup `-c` connection options, `ALTER ROLE` settings and legacy database custom parameters cannot satisfy or override the comment check. The command does not provision or repair identity. No agent or test runs this setup against managed infrastructure.

## Prepare the approved bundle

Keep the bundle outside the public repository in protected operational storage. It is strict JSON, at most 8 MiB, with exactly these three arrays:

- `profiles`: the ordered P-26 MeterProfile objects, each with its exact approved identity, version, digest, scope, display steps, historical applicability and verification/approval references.
- `verifications`: one `{id, stationId, content, authorizationReference}` per profile. `content` contains `{profileContent, measuredMeterIdentity, measurementReference, verificationNotes}`. The measured identity, measurement reference and notes must come from the actual verification; the command never fabricates them from a pump ID. `profileContent` is the exact canonical profile content excluding `digest` and `approvalReference`.
- `approvals`: one `{id, stationId, profileId, profileVersion, digest, profileContent, authorizationReference}` per profile. These bind recorded approval to the same canonical content and its digest.

Use the shared `meterProfileSchema`, `meterVerificationContentSchema`, `profileContent` and `profileDigest` in `src/server/modules/reviews/meter-policy.ts` to prepare and verify the approved records. The command independently validates all bindings. Unknown keys, wrong scope, overlapping profiles, inconsistent verification or approval, and changes to an existing immutable identity are rejected. A changed profile requires a new version and new verification/approval records. Existing identical records are reused when reactivating an approved profile set.

Each `authorizationReference` is a non-secret reference ID of 1–200 letters, digits, dots, underscores or hyphens. It records an approval held in protected operational storage; it does not grant one. Do not insert credentials, contact details or URLs. Treat measurement notes and all command output as protected domain material. Do not paste them in general audit records, application logs or public tickets.

## Preview and apply

The operator needs the exact installed meter artifact digest, approved station ID, database environment, past-or-current activation instant and authorization reference. Obtain the digest from the reviewed `meterReleaseDigest` export; do not hash Markdown or substitute a different artifact. The command retains the installed evaluator and resolver artifact bytes with each policy approval.

Use the following shape, replacing each uppercase placeholder with its approved value. No example display steps or profiles are supplied:

```sh
pnpm ops:meter activate \
  --station APPROVED-STATION-UUID \
  --environment staging \
  --digest INSTALLED-METER-SHA256 \
  --authorization APPROVAL-REFERENCE \
  --activated-at APPROVED-ISO-INSTANT \
  --bundle /protected/path/approved-meter-bundle.json
```

Dry run is the default; `--dry-run` is equivalent. It uses a read-only transaction and prints the exact proposed immutable rows, excluding the database-assigned `recorded_at`, and the `WHR_METER_POLICY` JSON. Preview IDs and the next revision are not reserved. Future meter activation is rejected. Activation also requires the latest approved active P-25 resolver for the same station/environment and installed digest.

After checking the complete preview against Earl's authorization, repeat the same command with `--apply --expected-revision N`, using the preview's revision. The command serializes policy state and writes new verification, profile approval, policy approval and configuration records in one transaction with bound SQL parameters. A changed revision or conflicting identity aborts the transaction. Re-preview and obtain matching authorization before retrying.

After successful apply:

1. Set `WHR_METER_POLICY` to the exact **apply output**, through the approved deployment procedure. Keep the P-25 runtime setting aligned with its latest approved active configuration.
2. Check `/api/health` while signed in as a live admin with `settings`. Meter readiness requires valid profiles covering every supported current pump/product/precision; an older sale can still lack historical coverage even when readiness is configured.
3. Keep applied revision, approval references and output in protected operational records. If commit acknowledgement is lost, inspect immutable history privately before retrying; the transaction may have committed.

The command neither sets deployment variables nor deploys, resolves holds, reevaluates sales or changes accepted history. Approval of this implementation is not approval to activate staging or production.

## Deactivate or roll back

Preview deactivation with the same station, environment, digest and a new authorization reference:

```sh
pnpm ops:meter deactivate \
  --station APPROVED-STATION-UUID \
  --environment staging \
  --digest INSTALLED-METER-SHA256 \
  --authorization DEACTIVATION-REFERENCE
```

Apply using `--apply --expected-revision N` after approval. Deactivation preserves the previous profile set and appends a higher inactive configuration with its authorization reference. It requires no working P-25 activation, so an operator can disable meter reconciliation when that dependency is unavailable. It writes no fictitious activation approval. The persisted higher revision immediately invalidates old active runtime configuration for new decisions; authorized successful replay remains historical.

Rollback uses `activate` with the previously approved bundle, a new authorization reference and a new activation instant. It appends a higher configuration revision and a new policy approval; it never edits or deletes an old profile, approval, evaluation or configuration. A profile with changed bytes under an existing identity/version is refused. No operation automatically releases held sales.
