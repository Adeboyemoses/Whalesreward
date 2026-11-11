---
branch: app/wo-7-sales-history
linear: WHR-15
tier: high
reviewed_head: 8fba180ea9411bdd0499565ecef59a8cf248f35a
rounds: 3
builder: frontend-engineer + offline-engineer + test-engineer
reviewers:
  code-reviewer: PASS (round 3)
  security-reviewer: PASS (round 3)
  integrity-reviewer: PASS (round 3)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 21
invariants: [I-03, I-06, I-07, I-09, I-22, I-23, I-26, I-28, I-29, I-37, I-38, I-39, I-41, I-42, I-44, I-48, I-49]
p1: [fixed definitive correction reason refusal and reviewed replacement, fixed correction-aware handover counts and upload completion]
tickets: []
plan:
  goal: Own sales history and numeric corrections plus authorized admin sales and late review
  files: src/client/sales*, src/client/offline/**, src/client/sw/**, src/app/(attendant)/attendant/history/**, src/ui/admin/sales*, src/ui/admin/portal.tsx, src/styles/**, tests/**, docs/briefs/**, docs/qa/**
  approach: Consume merged M3 strict contracts; separate account-partitioned frozen correction operations; original first; no blind rebase; ephemeral authorized history and photos; retain originals and server-only outcomes
  tests: Exact amount and quantity; populated Dexie migration; waiting original; replay after lost response; stale bases; account fencing; real-stack Playwright; 390/360 and 1440 fidelity; all required gates
  risks: Correction identity and monetary contribution; P-19 independent review; stale authority; unavailable evidence; no server-history or photo service-worker caching
---
Implemented A09/A10/A11 and B03/B04/S01 against existing M3 endpoints, P-19 and P-22.
Corrections retain separate account-partitioned identities, exact base digests and frozen submissions; originals and contribution stay server-owned.
History/evidence is transient; the service worker adds only a generic History shell and never caches server history or photos.
Round 1: code and integrity each found one P1; security passed. No P0, SEC-HIGH or INTEGRITY-P1 findings.
Fixed definitive HTTP 400 invalid_request reason refusals: preserve the failed operation, stop retries, allow a newly reviewed replacement.
Fixed handover accounting: count unsent corrections, recheck both queues after upload, distinguish durable review receipts from unsent work.
Both fixes have failing-before and passing-after unit and real-endpoint browser regressions.
Round 2: all three reviewers passed the functional fixes. Final validation exposed a test that polled the DB before the decision response; the test now awaits and asserts HTTP 200.
Round 3: all three reviewers returned PASS on the exact reviewed head; no production changes followed round 2, and the worktree/head remained unchanged during review.
Independent fidelity PASS: tests/design-parity/sales-history/REPORT.md, nine PNGs at 390/360 and 1440 px; 48 px controls and no overflow checked.
Board differences: A11 required reason and fixed recorded basis; B03 Export and B04 Correct/Mark duplicate/Cancel omitted; actual evidence/history replaces placeholders.
Smoke: docs/qa/smoke-2026-11-11-sales-history.md. Earl's combined M3 acceptance follows WO-app-8; READY is not acceptance.
Dispatch flag: 21 exceeds the high-tier flag of 8 because of separate builders, independent fidelity and three review rounds; no over-cap escalation (3 of 3 rounds).
Per Earl and WHR-63, the feature diff changes no STATUS, coverage or lane files.
Final-head EM gates: typecheck PASS, lint PASS (two deliberate private-image optimization warnings), 631 unit tests PASS, production build PASS; both timezone runs PASS (5 tests each).
Final-head full Playwright gate: 276 passed, 4 existing staging-only checks skipped on the local production server; zero failures. Real local PostgreSQL and private MinIO evidence used.
Native Linux Playwright was required for browser-process restart coverage because the host sandbox blocks native Chromium; remote browser runs were used for independent fidelity.
