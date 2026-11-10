---
branch: core/wo-7c-print-layout
linear: WHR-99
tier: high
reviewed_head: 5fa01d0a60e99f16fa0b83773d601ef1c7d7577f
rounds: 1
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 5
plan:
  goal: expose missing print layout as an actionable 409 and a value-free health flag
  files: src/server/modules/cards/**, src/server/modules/health/**, tests/**, .do/app.staging.yaml, docs/qa/**
  approach: implement merged m2 contract; share layout validity for health; add explicit staging-only placeholder with Q-553 comment; preserve all other error mappings
  tests: missing and invalid PDF layout return JSON 409 retryable false without mutations; Excel remains available; health validity and non-disclosure; staging placeholder and full repository gates
  risks: optional print configuration must not fail overall database health; placeholder awaits Q-553; no cloud operations or leaked layout values
invariants: [I-07, I-16, I-18, I-20]
p1: []
tickets: []
---
Prerequisite spec PR #98 merged at 112da2e before implementation.
Missing or invalid print layout returns JSON 409 with retryable false; client copy is unchanged.
The staging spec declares the approved non-secret placeholder with a Q-553 comment.
Health shares layout validation and reports only configured/unconfigured; database health semantics are unchanged.
All three independent reviewers passed round 1 with no findings; head and clean worktree verified after review.
EM gates on the reviewed code head: typecheck, lint, build, 536 unit tests and 393 integration tests passed.
Linux production-build browser suite: 236 passed, 4 existing staging-only skips, zero retries.
HTTP red/green regression first asserts the domain error code, then status; reverting the two status mappings produced 3 failures (expected 409, received 503), and restoring them passed all 3.
Tests verify no export, success receipt or inventory changes, continued Excel availability, and health non-disclosure.
Dispatch count includes one builder dispatch lost to a daemon restart before implementation.
No cloud operations or STATUS/coverage/lane edits. Placeholder remains pending Q-553.
Smoke runbook: docs/qa/smoke-2026-11-10-print-layout.md; Earl performs workbook section d (x1-x4).

