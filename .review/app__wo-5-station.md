---
branch: app/wo-5-station
linear: WHR-11
tier: high
reviewed_head: b84c7be84254a26ec1eac9fb2973db6c5370e991
rounds: 1
builder: frontend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 11
invariants: [I-01, I-02, I-03, I-04, I-05, I-05a, I-06, I-07, I-09, I-29, I-31, I-32, I-41, I-49]
p1: ["fixed catchall page remount dropping frozen price and assignment confirmations"]
tickets: [WHR-81]
plan:
  goal: deliver approved station price and attendant screens including restricted first password and P-21 without changing server authority or original queues
  files: src/app/(admin)/**, src/app/(attendant)/**, src/ui/admin/**, src/client/**, src/styles/**, tests/**, docs/briefs/**, docs/qa/**
  approach: use existing admin session shell and exact shared money helpers, typed M2 HTTP adapters, explicit frozen reviews and guarded retries, memory-only credential state, test-only offboarding contract fake until WHR-80 merges
  tests: real station and first-password fixtures, stale and lost confirmations, OR-grants and revocation, A17 original queue isolation, P-21 contract-fake then real endpoint, responsive board parity and complete EM gates
  risks: stale assignment or price confirmation, duplicate writes after uncertainty, passwords or prior-account data persisting, restricted sessions starting capture windows, rewritten queues, false fake-backed success claims
---

Frontend-engineer implemented the admin station flow; offline-engineer implemented restricted first password, A17 and retained partitions. Server authority, exact money and original queue/history boundaries remain intact. Actual P-21 backend #77 is in the base; production never uses the test fake.
Pre-review browser tests caught lost review state across catchall page remounts. Moving the portal into its persistent layout fixed all seven affected cases while retaining route/authority keys. Independent fidelity found and verified scoped table containment, field/CTA/badge and pump-origin result fixes. Invalid fixture preconditions are excluded from red evidence.
Formal round 1: code/security/integrity PASS at the frozen reviewed head, no findings, clean tree/head unchanged. Independent focused verification: code62, security22, integrity62 unit tests passed.
EM reviewed-head typecheck/lint/275 unit/build PASS. Default Linux browser matrix168 PASS/four existing staging-only skips, two workers, zero retries (2.9m); existing real PostgreSQL/Mailpit admin flows4 PASS (25.9s). Runtime/test source at1d41124 matches the reviewed head; only final QA Markdown and unrelated accepted Core T-18 docs followed. Reports preserve both real P-21 and test-only fake provenance.
Independent parity3 PASS: all15 original/built comparisons,42 fictional PNGs and43 geometry files. No document overflow; phone wordmarks/footer and48px targets checked at390/360. Extra first-password/unassigned/P-21 states have no dedicated board; inherited navigation/code formatting differences remain declared.
Explicit plan deviation: one-line playwright.config.ts local webServer.env trusted x-test-ip header lies outside the original files glob. Core platform specialist independently approved this loopback-only spawned-process fixture setting. Per-context documentation IPv6 isolates a proven shared unattributed180/IP read bucket; capacities/account limits/auth/permissions/timeouts/retries and production configuration are unchanged. Original precommitted plan block remains identical.
WHR-81 batches inherited pump-prefix display and an earlier isolated no-stack creation timeout whose specific historical cause is unknown. Ten diagnostic repetitions and final full matrix passed; no timeout/assertion relaxation. The separate observed429 failures have direct status proof; a stale-price fixture cascade now guarantees a material locked-current+1-kobo change.
Dispatch flag11 exceeds8: two builders, independent test production/resume, route/fidelity fixes, read-only fixture audit, Core test-config review and three formal reviewers. One formal round stays within cap3. Runtime model identity unavailable. No live staging Owner session, cloud/provider operation or staging-data mutation; shared READY records follow separately.
