---
branch: app/wo-6-customers
linear: WHR-88
tier: high
reviewed_head: b04c9fb56882f2ae9b6acaa6f1455645bdf81018
rounds: 3
builder: frontend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 26
invariants: [I-02, I-06, I-07, I-09, I-14, I-15, I-16, I-17, I-18, I-19, I-20, I-29, I-41, I-42, I-44, I-49, I-50]
p1: ["fixed malformed and null success responses plus unexpected transport exceptions retaining the original frozen card operation"]
tickets: [WHR-83]
plan:
  goal: deliver approved registration customer and loyalty card screens against M2 while keeping server authority and prior queues intact
  files: src/app/(admin)/**, src/app/(attendant)/**, src/ui/**, src/client/**, src/styles/**, tests/**, docs/briefs/**, docs/qa/**
  approach: extend persistent memory-only admin modules with typed M2 shared schemas and frozen reviewed operations, online-only attendant registration and fresh-card sale handoff, protected immutable export preview and downloads
  tests: real local registration duplicate and lost-response cases, guarded card lifecycle and binary exports, narrow grants revocation stale route and cursor fencing, PII persistence denial and existing queue preservation, independent board parity and complete EM gates
  risks: duplicate registration or batch writes after uncertainty, stale permission or inventory confirmations, prior-account PII or downloads surviving authority changes, receipt mistaken for current card authority, export snapshot or lifecycle drift and unapproved phone or printing policy
---

Frontend-engineer built the persistent admin customer/card modules; offline-engineer built online registration and fresh-card sale handoff. Independent test-engineer produced actual PostgreSQL/MinIO browser regressions and board parity. Server authority, original queues and capture/input bounds remain unchanged; no M3 recovery, phone/card change, server endpoint or schema work.
Formal round 1: code/integrity independently found the same P1, truncated successful JSON permitting a new operation; security passed. Round 2: code/security passed, integrity found JSON null throwing an unexpected TypeError with the same unsafe classification. Final general fix retains every unexpected dispatch outcome as uncertain while preserving valid domain refusals and authority fences. Actual inherited-client regression 8 red then64 green; real committed truncated/null response tests 2 null red then20 green, two projects/two repetitions/zero retries, original body/key/server IDs and one batch/audit/export snapshot retained.
Round 3 code/security/integrity all PASS at the frozen reviewed head with findings empty, blockers zero and clean/head checks unchanged. Independent focused checks: code70, security84, integrity96 tests passed. Three formal rounds remain within cap3.
EM exact-head typecheck/lint/413 unit tests/build PASS. Linux full default214 PASS/four existing staging-only skips, two workers/zero retries (3.3m); actual unconfigured-policy/expiry suite3 PASS (10.7s). No new skip, retry, timeout, quota or assertion relaxation. Earlier cached-version test precondition was corrected using a forced authoritative-read barrier, not a product change; its repeated proof passed.
Independent fidelity4 PASS, all13 scoped boards plus A24:28 fictional PNGs/28 geometry files and two actual protected PDF/QR probes. Desktop/phone layout and pending-versus-held tone defects were reproduced and fixed; pending-tone regression one red then two green. No overflow or phone targets under48px. Contract/inherited differences and headless native-PDF interior/physical-print limitations remain explicit in REPORT.md; no substitute HTML proof or acceptance claim.
Explicit plan-path deviations: additive src/shared/aggregate-display.ts and tests support M2 aggregate bounds without changing original capture helpers. WHR-85 Core independently approved strict corrected source at13f7971; fresh Core EM verified identical shared source at reviewed head,17 focused tests PASS and clean tree, and owns final merge. Core also independently approved the nine-line playwright.config.ts local spawned-server fixture phone/print/public Compose storage values; loopback/local/no-reuse and hard-coded create-only local bucket remain. No deployed policy or cloud/provider change. Original precommitted plan block is identical.
WHR-83 is an unchanged inherited route-fake duplicate-fulfilment failure observed once during an intermediate run; root cause remains unknown and final full runs passed unchanged. It grants no extra scope. Reports: tests/customers-cards/BASELINE.md and tests/design-parity/customers-cards/REPORT.md. Smoke runbook was committed before implementation; Earl's combined workbook acceptance is deferred and WHR-11/WHR-77 remain In Review.
Dispatch flag26 exceeds8: two builders with fixes, independent test production/resumes and fidelity, Core boundary reviews, nine formal review dispatches and Core merge ownership. READY records follow separately after verified green feature merge. No live staging Owner, staging-data mutation, main promotion or cloud/provider operation.
