---
branch: core/wo-8-corrections
linear: WHR-14
tier: high
reviewed_head: 433a60332b551a81765d37de17cc8f7f06d0d387
rounds: 4
builder: backend-engineer
reviewers:
  code-reviewer: PASS (approved supplemental round)
  security-reviewer: PASS (approved supplemental round)
  integrity-reviewer: PASS (round 3, unchanged integrity scope)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 17
plan:
  goal: implement approved P-22 numeric corrections, durable midnight classification, independent late review and scoped M3 sales reads
  files: prisma/**, src/server/**, src/shared/**, src/app/api/**, src/instrumentation.ts, jobs/**, tests/**, docs/qa/**
  approach: reserve immutable correction and first receipt before validation; serialize live authority and purchase guards; apply one accepted contribution or retain review/holds; bind all evidence and projections to the original sale
  tests: exact Lagos midnight and cross-midnight retries; stale/concurrent/cancel guards; P-19 approve/reject/replay exclusions; exact totals and retained holds; read/photo privacy; crash/restart and revocation during validation
  risks: no invented sale date or renewed window; retained validated photo only; no replacement of original capture facts; integrate merged WHR-84 before sign-off; recovery intake and hold/duplicate decisions remain future work
invariants: [I-07, I-09, I-22, I-25, I-26, I-28, I-29, I-35, I-37, I-38, I-39, I-40, I-41, I-42, I-44, I-45a, I-46, I-48, I-50, I-52]
p1: ["fixed current eligibility after durable hold resolution without erasing validation history", "fixed exact safe audit values, reasons, decision operations and immutable executor/seller snapshots", "fixed formatted-phone rejection and snapshot redaction at both HTTP mutation boundaries", "fixed dotted-phone matching and normalization in approved commit 3a003d4"]
tickets: [WHR-87, WHR-89]
escalation: "Earl approved on 2026-11-09 one extra review round, scoped to commit 3a003d4 only, by security-reviewer and code-reviewer against prior reviewed head 60595681. Any other change voids it."
---
P-22 numeric corrections, durable midnight classification, independent late review and scoped sales/photo reads implement the merged M3 contract. Original values, evidence, receipt and validation history remain immutable; current accepted contribution is replaced once and holds remain independent.
Rounds 1–3 found and fixed current-resolution eligibility, audit context, and formatted-phone privacy defects. The last dotted-phone fix is exactly commit 3a003d4 against 60595681; no other runtime or test change follows it. Head433a603 adds only the already prepared verification report.
Earl's current-session approval, 9 Nov 2026: “[core · WO-core-8] Earl approves one extra review round, scoped to commit 3a003d4 only (dotted phone numbers rejected before audit), by security-reviewer and code-reviewer against the current reviewed head. Any other change voids it. Record the approval in the evidence, merge when green, take WHR-14 to READY, then stop.”
Only code-reviewer and security-reviewer performed the supplemental review, on the exact approved delta, with PASS at433a603. Each independently passed18 focused HTTP cases. Integrity-reviewer PASS at60595681 is retained for the unchanged integrity scope under Earl's explicit two-role exception. All reviewer worktrees remained clean and heads unchanged.
EM verification on frozen source3a003d4: typecheck/lint/build,374 unit,330 PostgreSQL,5 time tests per UTC/New_York,111 named tests (70 integration+41 unit),13 fresh migrations, Linux browser168/four existing staging-only skips/zero retries/two local workers, sequential signed-upload1 PASS. Full named output: docs/qa/verification-2026-11-09-corrections.md.
WHR-87 records unchanged-path loading/fixture diagnostics and the corrected EM artifact-directory collision. WHR-89 records function-level gaps in the unchanged legacy redactor, without a claimed endpoint exposure. No assertions, timeouts or retry policy changed.
Dispatch flag17>8: three builders/testers, a browser diagnosis, two builder fix turns, nine ordinary reviewer turns and the two approved supplemental reviewer turns. The extra round has one explicit escalation; no review gate is bypassed.
WHR-80 and WHR-12 remain In Review. No correction screens, broad recovery intake, hold/duplicate mutation, cloud, manual staging-data or main promotion is claimed. READY records follow separately after the feature merges.
