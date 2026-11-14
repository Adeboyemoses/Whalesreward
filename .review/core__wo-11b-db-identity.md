---
branch: core/wo-11b-db-identity
linear: WHR-143
tier: high
reviewed_head: 7cd443b74c86f4ddf09463855cefa80b803b1faa
rounds: 1
builder: platform-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 4
plan:
  goal: make both operator identity checks work for a non-superuser database owner
  files: scripts/ops/review-evidence.mjs, tests/integration/*operator.test.ts, docs/ops/review-evidence.md, docs/ops/meter.md
  approach: exact-match current database comment via qualified pg_catalog lookups; preserve refusal text
  tests: owner-created comment succeeds; absent/wrong/extra text refuses; session/startup/role spoofing fails; operator regressions
  risks: owner controls database identity; no activation, digest, revision or policy changes; local disposable PostgreSQL only
invariants: [I-07, I-41]
p1: []
tickets: []
---

Approved WO-core-11b; raised from computed medium to high, cap 3. All three reviewers PASS in round 1, no findings.
Only the shared identity lookup changes production behavior; activation, digests, revisions and policy content are unchanged.
PostgreSQL 16.15 local fixtures assert non-superuser ownership and owner-written comments for both operators.
Focused RED before the helper change: 31 failed / 13 passed; GREEN: all 44 passed.
Tests cover exact labels, absent/wrong/extra text, session SET, startup -c, ALTER ROLE and legacy database GUC spoofing.
Runbook read-back and COMMENT via %I/%L gexec also executed locally as a non-superuser owner with a quoted database name.
EM gates at reviewed code head: typecheck PASS, lint PASS (two pre-existing UI warnings), unit 870/870, build PASS.
Full integration on PostgreSQL 16.15 with --maxWorkers=2: 54 files / 1093 tests PASS, including 44 operator tests.
Initial default-worker integration: 1092 passed / 1 timeout failure in database-waits, plus two operator teardown hook timeouts.
The bounded-worker rerun changed no assertions, timeout settings or code. Code reviewer independently passed 11 operator unit tests.
No real database or cloud operation. Feature PR excludes STATUS, coverage-map and lane files.
