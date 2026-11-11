---
branch: core/wo-7d-policy-status
linear: WHR-100
tier: high
reviewed_head: 165146312c09aec5a56c9e0d1e33f31a927cb763
rounds: 2
builder: backend-engineer and test-engineer
reviewers:
  code-reviewer: PASS (round 2)
  security-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 10
plan:
  goal: preserve actionable existing M2 errors through the edge and expose safe policy health
  files: src/server/**, src/app/api/health/**, tests/**, src/client/*.test.ts, docs/qa/**
  approach: remap existing auth delivery delegation phone and export_failed gates to 409; reuse environment-aware validators from a single snapshot; allowlist ten statuses and authorize named health output using live settings permission after the probe
  tests: HTTP remaps and unchanged messages with no mutation; isolated policy validation and no values; all public and privileged projections including revocation and database failures; desktop and phone messages; full repository gates
  risks: absent M3/M4 evaluators stay unconfigured; no new policy activation; public reset remains generic; health cannot expose secrets or extend sessions; retained transient errors remain 503
invariants: [I-07, I-09, I-10, I-12, I-15, I-16, I-18, I-20, I-41, I-52]
p1: [fixed unsupported environment health evaluation and projection]
tickets: [WHR-101]
---
Spec prerequisite PR #101 merged at 25ecdc9; branch starts after records PR #102 at 641f7c1.
Existing M2 auth/delivery/delegation/phone and card export_failed errors return JSON 409, retryable false; transient 503 mappings and public reset 202 stay unchanged.
Health uses a frozen environment snapshot, isolated shared validators, an exact ten-name allowlist and current settings permission after the probe. Public callers receive only the aggregate and existing probe fields.
Unimplemented M3/M4 evaluators remain unconfigured; no health request activates policy, renews sessions, probes providers or returns configuration values.
Internal export retries remain pending; terminal failed artifacts never restart. New preparation uses new IDs without changing reserved inventory. PR #97 storage deadlines, fencing and I/O outside locks remain intact.
Round 1 code/security found unsupported environment labels inheriting development defaults in health. Round 2 fixes this with explicit validation; malformed environments skip evaluators and deny named projection. All three reviewers PASS; final head and clean worktree verified.
EM final typecheck, lint, build, 579 unit tests and 409 PostgreSQL integration tests passed at reviewed_head.
Linux production-build browser suite on reviewed_head: 246 passed, 4 existing staging-only skips, zero retries; includes ten policy-message cases across desktop and phone sizes.
Genuine red/green tests detect old 503 mappings, failed-export restart, and unsupported environment disclosure (8 unit and 5 integration failures before its fix).
The existing production auth gate precedes delegation; direct and explicitly isolated HTTP tests verify delegation mapping without changing authorization order.
WHR-101 tracks unchanged pre-existing copy gaps: auth/delegation generic fallback and export same-preparation advice. Message tests prove preservation, not complete guidance.
Dispatch count exceeds the high-tier flag of 8: two builders, one browser-selector fix, three first-round reviewers, one health fix and three second-round reviewers. Round cap remains 3; two rounds used.
No cloud operations or STATUS/coverage/lane edits. Smoke runbook: docs/qa/smoke-2026-11-11-policy-status.md.
