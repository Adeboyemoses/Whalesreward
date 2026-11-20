# WHR-217 identifier sweep

The M1 `Id` contract and T-05 require canonical UUIDv7. Time bits in an
identifier never prove when a purchase happened. Contracts remain unchanged.

## SQL generators

| Location                                                                                               | Values generated                                                                                                                                | Resolution                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prisma/migrations/20261116071000_giveaway_reconciliation/migration.sql`, `supersede_phone_exclusions` | `audit_event.id`, its correlation ID, and `giveaway_phone_exclusion_transition.id`; transition content exposes the audit ID through detail/list | Preserve the applied migration checksum. The additive `20261120140000_canonical_uuid_v7` migration replaces both live generators with `whr_uuid_v7()`. The same trigger covers census, manager, timing, snapshot and partial-source invalidation; no other supersession generator exists.                    |
| `prisma/migrations/20261109181000_correction_receipt_guards/migration.sql`, one-time backfill          | `purchase_validation_block.id`                                                                                                                  | Preserve the historical migration checksum. This is an executed backfill, not a retained function or default. Its output is explicitly counted by the new migration preflight; any historical non-v7 row blocks deployment, without rewriting it. Fresh empty-database migration has no backfill candidates. |
| `prisma/migrations/20261120140000_canonical_uuid_v7/migration.sql`, `whr_uuid_v7`                      | PostgreSQL 16 UUIDv7                                                                                                                            | The core random UUID call supplies entropy bytes only. Before return, the helper writes all six Unix-millisecond bytes, version 7 and variant 10. No v4 identifier is returned or persisted. This narrow entropy use is allowlisted by the CI guard.                                                         |
| All Prisma schema defaults and SQL column defaults, generated columns, trigger bodies and functions    | Identifier defaults/generation                                                                                                                  | No other random UUID defaults, UUIDv4 extension calls, SQL UUID generators or implicit Prisma UUID defaults were found. Generated UUID columns extract existing foreign references from JSON and do not generate identities.                                                                                 |

The additive migration does not edit audit rows, exclusions, transitions, their
JSON content, related-event arrays, foreign keys, snapshots or original IDs.

## Historical rows and deployment preflight

Historical v4 rows **can exist**: the old supersession function generated them,
and the earlier correction backfill could have inserted v4 validation-block IDs.
Their existence is not treated as a serialization problem. There is no alias,
version-bit rewrite, replacement audit, fixture rewrite or relaxed validator.

The additive migration starts an explicit transaction and locks campaign,
validation-block, audit and transition writers before counting non-v7 values.
It refuses deployment with SQLSTATE `23514`, a WHR-217 message, counts and an
actionable hint if any affected row exists. Counts cover supersession audit IDs,
transition IDs, transition `auditEventId` content, and validation-block IDs.
The helper and trigger replacement happen only after that check. A failure
rolls back the whole migration; an old trigger cannot race the check.

A deployment must finish the migration job successfully before starting the new
application. A failed preflight must block rollout. Do not mark the migration
applied, bypass the job, mutate identifiers, disable immutability or delete rows.
Keep the existing release running and retain its immutable links. This fix is
ready for databases with no detected legacy rows; a database that reports rows
requires a separately reviewed preservation migration before upgrading. A stable
additive public-ID mapping with reversible lookup is a possible follow-up design,
not an authorized manual data operation.

Use this read-only inventory before rollout (it emits counts, not client data):

```sql
SELECT
 (SELECT count(*) FROM audit_event
  WHERE action='giveaway_phone_unavailable_superseded'
  AND substring(id::text,15,1)<>'7') AS supersession_audits,
 (SELECT count(*) FROM giveaway_phone_exclusion_transition
  WHERE substring(id::text,15,1)<>'7'
  OR substring(content->>'auditEventId',15,1)<>'7') AS exclusion_transitions,
 (SELECT count(*) FROM purchase_validation_block
  WHERE substring(id::text,15,1)<>'7') AS validation_blocks;
```

Record nonzero counts in the deployment issue and commission the preservation
migration; do not export row contents into the public repository. Tests exercise
an actual old-trigger supersession, capture its audit/exclusion/transition rows,
run the new migration, verify explicit refusal and rollback, and compare all
original rows byte-for-byte. A separate regression covers legacy backfill IDs.
Fresh-schema tests verify UUID version, variant, Unix milliseconds, uniqueness,
and supersede to typed HTTP detail/list, including intact proposal audit links.

## TypeScript, fixture and diagnostics sweep

| Generator location | Values and resolution |
| --- | --- |
| `src/server/lib/ids.ts`; all `newId()` callers; `uuid` v7 imports in client, seed, operators and tests | Already UUIDv7; retain. Every source location is listed in [the call-site table](identifier-generator-call-sites.md). No runtime `uuid` v4 import remains. |
| `scripts/diagnostics/card-storage-lock.ts` | Two persisted export/operation IDs now use SQL `whr_uuid_v7()`. |
| `tests/fixtures/held-release-browser.ts` | Persisted person-binding ID now uses SQL `whr_uuid_v7()`. |
| `tests/integration/giveaway-writers.test.ts` | Three persisted hold-resolution/block/duplicate IDs now use SQL `whr_uuid_v7()`. |
| `tests/integration/schema-contract.test.ts` | Seven generated IDs/code suffixes now use `uuid` v7. |
| `tests/integration/meter-operator.test.ts` | Fifteen generated configuration/reference/fixture IDs or disposable name suffixes now use `uuid` v7. |
| `tests/integration/review-evidence-operator.test.ts` | Five generated persisted fixture IDs or disposable name suffixes now use `uuid` v7. |
| `tests/e2e/automatic-mail-lifecycle.spec.ts` | Two persisted queue/correlation IDs now use `uuid` v7. |
| `src/server/modules/reviews/release-photo.ts` (two calls), `release-uploads.ts` (one) | Retain v4 solely for random private object-key components; separately generated entity IDs remain UUIDv7. Exact allowlist entries enforce each use. |
| `next.config.ts` | Retain v4 as opaque build stamp; no domain Id consumes it. |
| `src/client/sw/handover.js` | Retain v4 as ephemeral window-handover nonce. |
| `tests/admin-navigation/timings.spec.ts` | Retain v4 as document performance-correlation nonce. |
| `tests/integration/database-waits.test.ts` | Retain v4 solely as a disposable schema-name suffix. |
| `tests/price-adoption/helpers.ts`, `tests/sales-history/helpers.ts` | Retain one v4 call each as random fictional camera-artwork watermarks. No Id field consumes them. |
| Other random sources | Production `randomBytes` calls supply tokens, signing nonces or private object-key entropy, not canonical IDs; `Math.random` supplies retry jitter. No additional persisted/public ID generator found. |

## CI guard

`pnpm check:identifiers` runs 21 adversarial self-tests then scans tracked SQL,
Prisma and JavaScript/TypeScript sources. The stable CI build job runs it after
install. SQL functions/defaults/triggers/embedded queries, aliased UUID imports,
member references, destructuring, re-exports and Prisma v4 defaults are checked.
All new v4 references fail unless their exact path, source line, occurrence count
and non-ID reason are allowlisted. Historical migration exceptions additionally
pin the entire file SHA-256. Deleted, altered or expanded exceptions fail too.
