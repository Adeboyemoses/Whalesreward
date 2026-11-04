# Schema foundation

`schema.prisma` maps the logical entities in `docs/engineering/data-model.md`; generate the client with `pnpm exec prisma generate` after a frozen install. The reviewed SQL migration adds constraints Prisma cannot model: exact calculations, partial/exclusion indexes, composite ownership, immutable facts, append-only rows and deferred current-revision/evidence checks. Do not regenerate this migration and discard those guards.

`pnpm db:seed` inserts fictional board fixtures idempotently. It creates no password credentials or authenticated sessions, verifies no email and configures no campaign deadlines or retention policy. These fixtures are for local and CI databases only.

This work order does not implement the transactions named by the specification. Authentication/authorization and adapter mapping, serialized last-Owner protection, permission dependencies/delegation and revocation, token issuance/redemption, active-batch card linking/replacement, price activation, purchase validation and acceptance with audit, hold decisions, correction authorization, giveaway readiness and retention policy enforcement belong to their feature work orders. Database guards supplement those transactions; their presence is not a claim that those product flows work. Open D02/D05/D06 policies remain unresolved.

The deployment application role must not own schema objects or have DDL, trigger-disabling or TRUNCATE authority. Append-only row triggers and revoked PUBLIC mutation privileges are defense in depth; provisioning the restricted runtime role belongs to environment setup. Do not use the migration owner's credentials for runtime access.
