---
branch: core/WHR-181-original-date
linear: WHR-181
tier: high
reviewed_head: 8f691b02e07db7227f9e9c8a93fa006d4cce60cf
rounds: 1
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 5
plan:
  goal: preserve the true original sale date in original Values after date resolution
  files: src/server/modules/sales/**, src/server/modules/reviews/**, src/server/modules/held-release/**, tests/**
  approach: audit purchase-row original Values builders and repair reads using immutable original data while retaining the current verified date in current projections
  tests: failing then passing real PostgreSQL and real HTTP regressions for ordinary date resolution and P-29 date release, full repository gates
  risks: leaking current date into original history or hiding current verified dates; no schema, endpoint-shape or immutable revision changes allowed
invariants: [I-28, I-34, I-35, I-36, I-41, I-42, I-45a]
p1: []
tickets: []
---

WHR-181 commissioned by Earl on 17 Nov 2026. Base: origin/staging 03e6c73.
Audit sale detail, reviews, release preparation, reports and audit projections.
Do not edit STATUS.md, coverage-map.md or lane files in this feature PR.

All three independent reviewers PASS in round 1 with no findings; head and
worktree remained unchanged and clean after review. Code and integrity each
independently ran the four new PostgreSQL tests: 4 passed each.
The additional backend agent gotcha is required by the escape-to-test rule.
No schema, endpoint-shape or production revision-write changes.
Full callsite dispositions: docs/qa/verification-2026-11-18-original-date.md.
Red: ordinary, P-29 and actual HTTP cases reproduced original date leakage;
non-null-original case also failed before the repair. No original Values
immutability assertion was relaxed. Focused PostgreSQL: 100 passed.
EM: typecheck/lint/build PASS; lint has two existing image warnings.
EM: unit 981 passed; timezone 5 passed in each of UTC and America/New_York.
EM: actual Next/PostgreSQL 16/MinIO HTTP 2 passed, including decision replay.
EM PostgreSQL 16 full run: 1,446 passed; seven fixture-skipped tests and an
operator cleanup hook made two suites fail. Fresh allowlisted disposable DB:
both affected suites rerun, 39 passed, zero skipped, no source/test changes.
The 77 suites cover 1,453 distinct tests; CI full integration must pass.
Review gate self-tests 53 passed; guard self-tests 94 passed.
Local full browser launch is blocked by macOS MachPort sandbox permissions;
the required CI e2e check must pass before merge.
Initial local PostgreSQL 15 runs had fixture-role and missing pg_input_is_valid
failures; stopped and rerun on isolated PostgreSQL 16 matching CI. An initial
HTTP fixture sign-in failed before exercising the change; clean reruns passed.
