# WHR-184 campaign proof verification

[Feature PR #171](https://github.com/Adeboyemoses/Whalesreward/pull/171) merged into staging at
`4fe42cd1c4098f6796b92f458189d0f0090b373e`. Final PR head:
`f3e8817253c20e5a6c344b48c797ca251f244eab`; independently reviewed code:
`d03197bb65359c8dd1a205c811962f1c3c5f6211`. Code, security and integrity PASS
round 1 of cap 3; evidence validator PASS. All five required CI checks green.

## Fix and provenance boundary

Both ordinary and P-29 writers now parse the same protected Zod envelope that the
giveaway reader parses after its existing SQL bindings. The P-29 writer adds the
committed purchase/decision IDs, closure, resulting revision and meter-evidence
ID; its existing applied purchase version is retained. Card, date, price and
capture envelopes all use this shape. Loose extension fields preserve private
people, reasons, attestation and certificate provenance.

The SQL purchase/decision/station/version/revision/evidence bindings are unchanged.
Campaign/settings pins and malformed/contradictory proof checks still fail closed.
Historical proof binds its committed decision, allowing a later valid numeric
correction to contribute the current accepted revision. No historical data
backfill, public response change, runtime activation or product-doc edit occurred.

## Red before green

Four card/price/date/capture envelope assertions failed before the repair because
purchase/decision target IDs were missing. On unchanged production source, real
HTTP meter PUT, paper reserve/upload URL/PUT/finalize, proposal and independent
approval succeeded; the inside sale then counted all-time but its campaign row
was absent. Outside exclusion passed. The same complete test passed after repair.

## Named regression tests

- `WHR-184 I-45a real HTTP inside and outside proof reaches both leaderboards, readiness and immutable snapshot sources after later correction`
  in `tests/campaign-proof-e2e/campaign-proof-real.spec.ts`: actual image PUTs,
  self-approval refusal and independent approval, both bases, manager designation,
  census, phone check, readiness, initial/revised exact accepted sources, late
  numeric correction, frozen originals/predecessor, policy-off refusal/replay,
  foreign settings exclusion and foreign campaign refusal.
- `WHR-184 P-29 campaign reader rejects a foreign %s binding` in
  `tests/integration/held-release-service.test.ts`, seven purchase/decision/station/
  purchase-version/revision/meter-evidence/closure cases; foreign campaign/settings
  and outside proof are also asserted.
- `WHR-184 rejects campaign proof with a foreign %s binding` in
  `tests/integration/giveaway-provenance.test.ts`, seven ordinary-proof guards.
- `SR-08 %s approval preserves original evidence and exact protected people provenance`
  in `tests/integration/held-release-service.test.ts`, all four release targets.

## Measured results

EM final source checks: typecheck PASS; lint zero errors/four existing image
warnings; unit **997/104 files**; real PostgreSQL 16 integration **1,534/79 files**;
time **5+5** in UTC and America/New_York; production build PASS; dedicated real
HTTP **1** and existing release HTTP **10** PASS.

[Feature CI 44499372604](https://github.com/Adeboyemoses/Whalesreward/actions/runs/44499372604):
unit **997**, PostgreSQL **1,534**, time **5+5**, release **42**, dedicated campaign
HTTP **1**, ordinary browser **429 passed / 1 retry pass / 4 existing skips**,
signed-storage browser **1**. The new regression and release suite had no retries.
The retry is the pre-existing WHR-177 fixture deadlock, desktop
`I-11 leaderboard-only viewer sees live rows but cannot inspect purchases or finalize`,
at `tests/leaderboards/helpers.ts:159` while inserting fictional settings history.
Its occurrence and `found-in:WHR-184` label are recorded on WHR-177; no extra fix.

## Local setup and limitations

Docker was stopped and images uncached. Started local Docker, built the tracked
MinIO image and ran the worktree's clean Compose PostgreSQL16/MinIO volumes.
`BUILDX_CONFIG=/tmp/whr184-buildx` kept build metadata inside writable temporary
storage. PostgreSQL used loopback port 5433; MinIO health returned ready on 9000.
No cloud resource or credential file was read or changed. Fictional Compose
configuration and test-process-only policy fixtures were used.

The initial custom integration DB name was refused by a fixture safety guard;
the complete suite passed on the supported disposable `whr_test` database.
Clean local MinIO accepted every actual PUT, including original meter and both
inside/outside paper images. No storage step was skipped, mocked or replaced.
The dedicated Playwright config creates/tears down an isolated schema, preventing
its campaign/settings/inactive-policy history from contaminating other suites.

Local Chromium was initially missing; installing it exposed macOS bootstrap denial
(1100/SIGTRAP). The 32 release UI cases could not launch locally; ordinary e2e
hit the same restriction and was stopped. Complete Linux CI browser suites and
signed-storage test passed. No native or physical-phone smoke is claimed.

Smoke runbook: `docs/qa/smoke-2026-11-19-proof.md`. Earl's end-of-M4 smoke and any
runtime policy activation remain separate. Stop at READY.
