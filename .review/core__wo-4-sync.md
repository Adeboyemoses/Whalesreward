---
branch: core/wo-4-sync
linear: WHR-6
tier: high
plan:
  goal: implement M1 lookup, durable sync and exactly-once evidence-backed credit with P-18
  files: src/server/modules/sync/**, src/server/adapters/storage*, src/shared/contracts/sync*, src/app/api/**, prisma/**, jobs/orphans.ts, tests/**, package.json, pnpm-lock.yaml, docs/qa/**, docs/engineering/coverage-map.md
  approach: preserve original receipt and context; evaluate bounded history in one policy module; validate staged bytes into immutable final storage; atomically claim revision and audit with live authority checks
  tests: real PostgreSQL lost-response retry, concurrent finalize and adversarial staging overwrite; P-18 boundaries, isolation, metadata and decode limits; MinIO and Spaces-compatible signing
  risks: storage and database cannot commit together; history uncertainty must hold without credit; additive schema and signing must preserve replay and immutable evidence
---

Implementation follows docs/engineering/contracts/m1.md including WO-spec-3a.
Backend owns production schema, service, routes, adapter and focused unit tests.
Test engineer owns independent real PostgreSQL/MinIO integration and HTTP tests.
EM owns verification, coverage, review, PR and session records.

1. Add strict M1 lookup/sync contracts and canonical payload hashing; test unknown fields, normalized codes/numbers, conflicts and calculation/medium rejection.
2. Persist original/context/first receipt and scoped durable upload/finalize operations using existing pg transactions and database invariants; preserve zero-credit pending lookup on transient failure.
3. Implement P-18 in src/server/modules/sync/capture-policy.ts: complete historical coverage over original sign-in through first receipt; precision-only changes ignored for rate; return all price/authorization/campaign conditions; no phone-clock authority.
4. Implement private storage interface with S3-compatible MinIO/Spaces signing, fixed JPEG headers, short permission expiry, bounded stream/decode and digest validation, immutable random final keys and safe orphan skeleton without deletion.
5. Implement lookup, submit, upload-permission, finalize and by-operation HTTP routes with current account scope, Origin, no-store, limits and no sensitive errors/logging. Recheck authority after storage and claim acceptance/revision/audit transactionally.
6. Independently prove lost submit/finalize response, concurrent finalize, staged overwrite after acceptance, holds surviving retries, cross-account attempts, stale versions, exact window expiry, storage failures and reauthentication preserving P-18 bounds on real PostgreSQL; use real MinIO PUTs for adversarial storage.
7. EM runs typecheck/lint/unit/build/integration/e2e/time, pastes named output, dispatches three read-only reviewers within three rounds, commits evidence, merges green staging PR, records READY and stops.
