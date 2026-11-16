---
branch: core/WHR-153-stuck-hold
linear: WHR-153
tier: high
builder: backend-engineer
reviewed_head: a673238c601845842eab7a1f5e3e8fab86d0e7d3
rounds: 4
escalation: Earl approved round 4 on 2026-11-16 for PR 148, test-only nine hook tests at a673238, with fresh code/security/integrity verdicts; stop on any new finding or production change, no round 5
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 27
invariants: [I-07, I-22, I-25, I-26, I-28, I-31, I-33, I-34, I-35, I-41, I-46, I-48]
p1: []
tickets: [WHR-123, WHR-155]
plan:
  goal: implement inactive two-person stuck-hold release under immutable review-evidence-v2
  files: prisma/**, src/server/**, src/app/api/**, src/shared/**, scripts/ops/**, docs/ops/review-evidence.md, tests/**
  approach: append-only proposals and transitions with canonical person checks, guarded admission and joint consistency, private sheet pipeline, shared giveaway generation locks and database-comment operator identity
  tests: real-Postgres SR-01 through SR-08 including SR-02a, non-superuser role checks, full existing gates and independent code/security/integrity reviews
  risks: credit and cancellation races, alias-account self-approval, evidence privacy, partial policy installation and stale giveaway snapshots; v1 remains active and meter stays unconfigured under v2
---
Round 4: code, security and integrity PASS at a673238; no new findings or production changes.
Earl approved this test-only fourth round on 2026-11-16; no fifth round is authorized.
Round 1 identity, private-reason disclosure, synthetic provenance, obsolete deadline and
boundary-lineage findings were corrected before round 2; code/security passed thereafter.
WHR-155 Option A amends WHR-153: tested blocker/generation hooks ship now;
actual initial/revision/unchanged giveaway SR-06 workflows move to WHR-22.
Round 3 identified missing direct hook tests. Nine PostgreSQL hook tests close that gap:
terminal transitions, stale pending blockers, station isolation, distinct counts,
rollback, generation changes, reconciliation flags and unchanged fixture snapshots.
All three round-4 reviewers found no new issues. Their local PostgreSQL reruns could
not connect to the stopped disposable database; execution evidence is the EM and CI runs.
EM gates and CI run 43802667522: typecheck, lint (two existing warnings), build,
955 unit tests and 1322 PostgreSQL tests pass; both prior timeout cases pass in the full suite.
Timezone tests: 5 UTC + 5 America/New_York. Browser: 401 passed, 1 passed on retry,
4 existing skips; separate storage browser test: 1 passed. Review/guard self-tests pass.
Exact named SR-01 through SR-08 (including SR-02a): tests/integration/held-release-matrix.md.
V2 installation stays unconfigured; v1 remains active; meter remains unconfigured under v2.
No end-to-end giveaway verification is claimed. WHR-22 owns the remaining real SR-06 tests.
No activation, cloud change, real database access, screens or feature changes to STATUS,
coverage-map or lane files. WHR-123 records the pre-existing browser preview-download issue.
