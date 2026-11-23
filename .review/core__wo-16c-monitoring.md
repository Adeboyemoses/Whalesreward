---
branch: core/wo-16c-monitoring
linear: WHR-211
tier: high
reviewed_head: 6990736bd5b83dca2269d6b15a8075c44dfdfeb6
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 10
plan:
  goal: expose restricted count-only monitoring and detect missing policies without leaking request or customer data
  files: src/server/lib/logger*, src/server/modules/health/**, src/server/modules/monitoring/**, src/instrumentation.ts, src/app/api/**, jobs/**, tests/**, docs/ops/production.md, docs/engineering/contracts/operations.md
  approach: reuse live authority and policy evaluators, persist no business changes, read fenced maintenance records, whitelist telemetry fields and audit real HTTP logs across all route families
  tests: real PostgreSQL and HTTP health/authority/heartbeat failures, startup missing policies, synthetic body/header/query/token/phone canaries, unit and full repository gates
  risks: public health must stay four fields, no static diagnostics bypass, no policy activation or business mutations, no raw exceptions or private inventories in telemetry
invariants: [I-07, I-09, I-48, I-50, I-51, I-52]
p1: ["fixed early expiry with an exact rolling 300000 ms window and three regressions"]
tickets: [WHR-226]
---
Restricted count-only monitoring reads durable WHR-210 heartbeats, policy states and backlog ages/counts.
The protected deploy check and signed-in browser assertion name missing policies and lookup issuance readiness without values.
Every API method uses pathless status counters and sanitizes unhandled and response-stream errors.
The automated real-HTTP audit discovers 139 route files, 147 methods and 39 families; it covers success, denial, malformed requests and unavailable PostgreSQL.
Redaction finding fixed: the prior blacklist leaked arbitrary nested data, child bindings and free-form messages. Strict projection now excludes these canaries.
Round 1 code P1 found minute buckets expired errors early. Exact-window FIFO plus boundary/expiry/backward-clock regressions fix it; all three reviewers PASS round 2.
Audit fixture timing was stabilized after EM reproduced a microsecond mismatch in its exact 24-hour context constraint; three fresh restricted-role repeats passed.
EM final checks: typecheck, lint (four existing warnings), 1035 unit, build and 12 real-HTTP/non-superuser PostgreSQL tests PASS.
Full integration and Linux browser CI results are recorded in the PR/READY report. Local Chromium is blocked by macOS Mach-port sandbox denial.
WHR-226 tracks Earl-only deployed ingress redaction, native DigitalOcean coverage gaps and received failure/recovery alerts; no service or processor was set up.
WHR-154 startup lifecycle remains separate; this work supplies the authorized deploy-check alternative. No policy activation, cloud action, migration or business mutation.
