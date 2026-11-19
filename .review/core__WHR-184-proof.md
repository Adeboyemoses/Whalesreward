---
branch: core/WHR-184-proof
linear: WHR-184
tier: high
reviewed_head: d03197bb65359c8dd1a205c811962f1c3c5f6211
rounds: 1
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 5
plan:
  goal: preserve bound P-29 campaign proof through contribution reads and snapshots
  files: src/server/modules/reviews/**, src/server/modules/giveaway/**, tests/**, docs/engineering/contracts/**, docs/qa/**
  approach: reproduce through HTTP then share a typed provenance schema across writers and reader while retaining purchase decision station evidence revision version and campaign settings bindings
  tests: real PostgreSQL and storage HTTP sheet reserve PUT finalize proposal independent approval both leaderboard bases readiness reconciliation snapshot sources; outside foreign campaign settings policy-off replay later correction; card date price targets
  risks: accepting foreign or stale provenance can misrank spend; retained historical proof must survive policy-off replay and valid later numeric correction without rewriting originals or snapshots; no policy activation
invariants: [I-07, I-25, I-26, I-28, I-31, I-33, I-34, I-35, I-42, I-43, I-45, I-45a, I-46]
p1: []
tickets: []
---
Plan committed before two builder dispatches; three independent reviewers PASS
round 1 on the reviewed head above, no findings or open blockers. Worktree/head
unchanged after review. No policy activation or session-record changes.

One shared protected Zod envelope validates ordinary/P-29 writers and contribution
reads. Existing SQL purchase/decision/station/version/revision/evidence bindings
remain; campaign/settings pins and malformed/contradictory proof fail closed.
Card/date/price/capture envelopes share the same fields; private provenance stays.
Historical decision binding survives a later legitimate numeric correction.
No migration/backfill or relaxation for old malformed provenance.

Red: four target envelope assertions failed; real HTTP inside sale counted all-time
but campaign row was absent after actual meter/sheet PUTs and independent approval.
Green: dedicated HTTP test passes through both bases, readiness, normal census/check,
initial/revised saved sources, outside, foreign campaign/settings, policy-off replay,
late numeric correction and frozen originals/predecessor. Isolated schema/config/CI
keeps its historical campaign/policy fixture changes out of other release tests.

EM gates: typecheck PASS; lint 0 errors/4 pre-existing image warnings; unit 997/104;
PostgreSQL 16 integration 1534/79; time 5+5 in UTC and America/New_York; build PASS;
real HTTP regression 1 PASS; existing release HTTP 10 PASS. Real MinIO PUTs worked
with a clean local fixture volume; no storage step was skipped or mocked.
Initial integration custom DB name hit a fixture safety guard; rerun on whr_test
passed the entire suite. Chromium installed locally, but macOS denies bootstrap
(permission 1100/SIGTRAP): release UI 32 could not launch, ordinary e2e similarly
blocked and stopped. Full Linux CI browser/release/storage suites must pass to merge.
Smoke: docs/qa/smoke-2026-11-19-proof.md. Named tests are listed in the PR.
