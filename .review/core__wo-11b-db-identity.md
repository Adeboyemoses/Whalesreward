---
branch: core/wo-11b-db-identity
linear: WHR-143
tier: high
plan:
  goal: make both operator identity checks work for a non-superuser database owner
  files: scripts/ops/review-evidence.mjs, tests/integration/*operator.test.ts, docs/ops/review-evidence.md, docs/ops/meter.md
  approach: exact-match current database comment via qualified pg_catalog lookups; preserve refusal text
  tests: owner-created comment succeeds; absent/wrong/extra text refuses; session/startup/role spoofing fails; operator regressions
  risks: owner controls database identity; no activation, digest, revision or policy changes; local disposable PostgreSQL only
---

Approved WO-core-11b. High risk, round cap 3. Feature PR excludes STATUS, coverage-map and lane files.
