---
branch: core/wo-16c-monitoring
linear: WHR-211
tier: high
reviewed_head: 0bccb61
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: expose restricted count-only monitoring and detect missing policies without leaking request or customer data
  files: src/server/lib/logger*, src/server/modules/health/**, src/server/modules/monitoring/**, src/instrumentation.ts, src/app/api/**, jobs/**, tests/**, docs/ops/production.md, docs/engineering/contracts/operations.md
  approach: reuse live authority and policy evaluators, persist no business changes, read fenced maintenance records, whitelist telemetry fields and audit real HTTP logs across all route families
  tests: real PostgreSQL and HTTP health/authority/heartbeat failures, startup missing policies, synthetic body/header/query/token/phone canaries, unit and full repository gates
  risks: public health must stay four fields, no static diagnostics bypass, no policy activation or business mutations, no raw exceptions or private inventories in telemetry
invariants: [I-48, I-50, I-51, I-52]
p1: []
tickets: []
---
Implementation of production section 4 and Earl's O09/O11 decisions. No cloud action or processor setup.
WHR-154 remains a separate startup-diagnostics dependency; use a deploy check for WHR-152 here if needed.
