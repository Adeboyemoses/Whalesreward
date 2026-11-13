---
branch: core/wo-13-reports
linear: WHR-24
tier: high
reviewed_head: 0f630b5eef48af9a14a4151f130e3a16babcea77
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 10
plan:
  goal: Implement operational reports, overview and immutable private exports per amended M4 and WO-core-13 gaps.
  files: src/server/modules/reports/**, src/server/modules/overview/**, src/server/modules/customers/**, src/server/modules/audit/**, src/server/adapters/**, src/shared/contracts/**, src/app/api/admin/**, prisma/**, tests/**, src/instrumentation.ts
  approach: Share one exact accepted-contribution predicate and database generation across snapshot reads; freeze export inputs and reuse fenced bounded card-export lifecycle with storage outside locks and live creator authority.
  tests: Real PostgreSQL gaps and report verification including stored meter pairs, original attribution, flags, buckets, generations, overflow, precision and formula safety, audit privacy, revocation, leases and expiry; full repository gates.
  risks: Generation must cover all contributing writers; immutable snapshot and audit atomicity, export precision and lock-free storage require concurrency tests; no campaign policy activation or evidence deletion.
invariants: [I-05, I-07, I-09, I-29, I-40, I-41, I-42, I-44, I-45, I-48, I-52]
p1: []
tickets: [WHR-113]
---
Approved WHR-24 / WO-core-13 implements the amended M4 reports and overview scope.
The initial plan was committed before the builder; its customer-predicate file scope
was clarified before review. Reports, sources, exports and customer totals share
accepted contribution semantics. Source data and generation share one SQL snapshot.
Exact stored meter pairs, captured attribution, flags and exclusion precedence remain.
Exports freeze source rows, use fenced leases and bounded storage outside locks,
recheck creator authority, expire at 24 hours and emit typed version-2 terminal audit.
Before formal review, adversarial tests found eager storage creation masking 409
export errors and malformed v2 audit projection returning 404; both have regressions.
Full integration found retention intent advancing generation; the trigger now excludes
retention, and existing campaign preservation assertions remain unchanged.
Round 1 code/security/integrity PASS; integrity identified a P2 currency-test gap.
Round 2 all PASS after a PostgreSQL projection test proved live USD rejection then
widened only disposable fixture currency checks. No production currency change.
No open findings. Review rounds left the worktree clean and the reviewed head unchanged.
EM final-head verification: typecheck, lint, unit 852/88 files, build, PostgreSQL
1074/54 files, UTC time 5 and New York time 5, Linux browser 308 plus 4 existing skips PASS.
Two inherited image warnings remain. Existing operator DB-cleanup timeouts under
parallel load were also seen on the unchanged baseline; isolated tests and the full
serial PostgreSQL gate passed. Observation attached to existing WHR-113; no test
assertion, timeout or retry setting was weakened.
Named coverage: docs/qa/verification-2026-11-13-reports.md, including real P-26 values,
100001-row ceiling, exact large sums, generation races, revocation, leases and privacy.
Dispatch flag: 10 exceeds 8 because independent test follow-up and all three reviewers
were retained for the second round; review cap remains 3 and used rounds are 2.
No STATUS, coverage-map or lane files changed. No cloud or main-branch operations.
