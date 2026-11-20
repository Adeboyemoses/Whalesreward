# Report-only scheduled jobs implementation plan

Goal: implement WHR-210 / WO-core-16a from production.md section 3 and operations.md.
Architecture: reuse MaintenanceRun, persist a per-job/scope lease with monotonic fencing, and atomically append protected findings with each resume checkpoint. Inventory reads never invoke business mutations or a storage write interface.
Spec: docs/ops/production.md section 3 and impact notes; docs/engineering/contracts/operations.md; WHR-56.

## Constraints

- Hourly orphan inventory; 15-minute upload reconciliation; maximum ten-minute slices with continuation and bounded provider/database deadlines.
- Inventory aged staged and unreferenced final candidates, preserving pending/hold/lease/version references. Age never authorizes abandonment or deletion.
- Compare expected/observed meter and sheet assets, missing digests and stalled upload age. Observe bytes with bounded SHA-256 verification where needed; ETag is not a digest.
- No delete, lifecycle change, multipart expiry, evidence/revision/receipt/hold/credit/campaign mutation; no cloud resources. All generated IDs use newId() UUIDv7.
- Reports/telemetry contain only closed codes, counts, UUID references and UTC operational times; no object keys/URLs, arbitrary provider strings, names or customer data. Internal resume cursors are protected operational state.
- Preserve complete watermark on partial/failed runs. Persist heartbeat, next due, scheduled completion deadline, start/end, outcome and sanitized error for WO-core-16c. Public health shape unchanged.
- No feature changes to STATUS, coverage-map or lane records. Do not add an admin HTTP surface unless needed; if added, update the contract and exercise real HTTP live authority/revocation.

## Review focus

Stale worker after lease takeover; crash between page observation and cursor commit; provider page/version truncation; concurrent new evidence references; arbitrary object metadata or failure strings leaking into findings.

## Tasks

- [ ] Add failing integration tests on real PostgreSQL/MinIO for concurrent single runner, expired fencing, checkpoint restart, bounded pagination and partial provider failure.
- [ ] Add additive schema/migration and a maintenance repository that restricts business reads and permits writes solely to run/lease/report records. Persist fenced page commits, durable continuation and heartbeat fields. Reuse existing immutability conventions and test non-superuser permissions.
- [ ] Implement a separate read-only storage adapter with list/version/read deadlines and bounded retries, then orphan/reconciliation scanners. Preserve source IDs and reference IDs; never serialize raw keys or exception text.
- [ ] Replace only the two requested skeleton entrypoints with executable bounded runners. Document local invocation, separate maintenance credentials/permissions, schedules, heartbeat semantics and report protection in docs/ops/maintenance.md; document telemetry in operations.md.
- [ ] Test missing/digest/size/receipt discrepancies, stalled pending uploads, retained sheet sources, no deletion/lifecycle authority, no evidence/revision writes, byte-identical domain state, UUIDv7 and log canaries. Run real HTTP only if an admin results read is introduced.
- [ ] Run identifier guard, typecheck, lint, unit, integration and build. EM reruns gates and dispatches code/security/integrity reviewers with cap three rounds, commits evidence, opens/merges PR to staging only when all checks pass.
