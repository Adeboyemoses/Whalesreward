---
branch: core/wo-6-station
linear: WHR-10
tier: high
reviewed_head: 3995e55d5a1e6f040925da334adf2e443124849f
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS (round 2)
  security-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 9
plan:
  goal: implement M2 pumps, immediate immutable product prices, attendant provisioning and assignment handover
  files: prisma/**, src/shared/contracts/**, src/server/**, src/app/api/**, tests/integration/**
  approach: reuse live admin security locking and durable receipts; serialize product activation and assignment changes; preserve capture contexts
  tests: real PostgreSQL races, replay and stale versions, first-password restriction, old queue history and P-20 changes inside/outside capped interval
  risks: additive schema and restricted first-password sessions; no history rewrite or stale authority at commit; disputed status operations await Earl
invariants: [I-01, I-04, I-05, I-05a, I-07, I-09, I-29, I-31, I-32, I-41, I-45a]
p1: ["fixed sign-in compatibility for provisioned and replacement passwords"]
tickets: [WHR-76, WHR-77, WHR-78]
---
Plan committed at a68fefd before builder dispatch. All three reviewers passed round 2
at the reviewed head; worktree remained clean and head unchanged after both rounds.
Round 1 reproduced a blocking price-activation visibility race: a pending activation
could be absent from settlement history then commit inside the original P-20 interval.
Per-station/product exclusive activation and shared settlement transaction locks now
serialize visibility; separate awaited statements preserve snapshot timing and original R.
Paused-COMMIT regressions fail before the fix and pass for in-interval, precision-only
and outside-U controls. Shared exact password validation fixes inaccessible credentials;
keyed bounded cursor fingerprints fix Unicode/escaped maximum-length pagination.
EM final exact-source checks: typecheck/lint/build, unit248, PostgreSQL178, named27,
time3 per timezone, Linux browser104/four inherited staging-only skips, signed-upload1 PASS.
Named output and commands: docs/qa/verification-2026-11-06-station.md. No gate relaxed.
WHR-76 records disputed operations excluded by M2; WHR-77 tracks first-password UI;
WHR-78 tracks one reviewer fixture-extension setup collision (EM parallel gates passed).
Backend M2 handoff only; no full work-order acceptance, UI parity or cloud/data operation.
Dispatch flag: nine feature dispatches exceeds eight; two review rounds remain within cap.
