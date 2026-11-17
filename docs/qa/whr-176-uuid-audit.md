# WHR-176 UUID generator audit

Searched tracked source, tests, jobs, scripts and root configuration for `randomUUID`, including named imports. The only production value reaching a UUIDv7 contract is the persisted sheet ID in `release-uploads.ts`, returned as both uploadId and assetId. It must use `newId()`.

Other production occurrences remain intentional: release-uploads staging keys and release-photo final/display keys are random private storage paths; the service-worker handover value is a correlation nonce; next.config build IDs are cache/version labels. None enters an authId/UUIDv7 contract.

Test occurrences: sales-history captureId and price-adoption unique are drawn into fictional camera pixels; admin-navigation documentId marks a document instance. Integration database-waits and operator suites use random schema/database/role names. Meter/review-evidence operator IDs are operator-policy generic UUIDs or direct database fixtures. Schema-contract UUIDs exercise database constraints directly. Automatic-mail-lifecycle IDs seed database-only mail records. No fixture IDs were rewritten.

The regression config supplies a fictional v2 policy only to its isolated local test server and disposable PostgreSQL schema. It does not activate any deployed environment or alter runtime defaults. The test carries the returned reservation IDs unchanged through HTTP upload URL, real object-store PUT, finalize and proposal.
