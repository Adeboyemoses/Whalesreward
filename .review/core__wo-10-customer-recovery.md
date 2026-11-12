---
branch: core/wo-10-customer-recovery
linear: WHR-18
tier: high
reviewed_head: bb9f21fe32688cd263f0f2f4ef50632b0535a9d7
rounds: 3
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 14
invariants: [I-07, I-09, I-15, I-19, I-21, I-21a, I-33, I-41]
p1: []
tickets: []
plan:
  goal: implement C02–C05 card-present phone change, protected history, manager intake and verified lost-card replacement
  files: prisma/schema.prisma, prisma/migrations/**, src/server/modules/customers/**, src/server/adapters/phone-verification.ts, src/shared/contracts/customer-recovery.ts, src/app/api/admin/customers/**, tests/**, docs/qa/verification-2026-11-12-customer-recovery.md
  approach: live security lock then deterministic customer/card locks, durable operation receipts and delivery generations, keyed verifier and atomic identity-change audit with replacement consumption
  tests: real PostgreSQL C02–C05 acceptance and adversarial races, strict API permissions/status/privacy, full typecheck lint unit build integration and browser gates
  risks: identity reassignment and concurrent upload, OTP replay and resend races, PII leakage, additive purpose-specific constraints must preserve email verification
---

Approved scope: WHR-18 and M3 C02–C05. The routing script reports medium for anticipated paths; this plan raises the tier to high with code, security and integrity review, cap 3.
No STATUS, coverage or lane changes. No stranded-queue recovery, manager decision endpoint, provider selection/configuration or cloud actions.
Production and staging fail closed with 409 phone_verification_unconfigured. Test adapter is server-only and test-injected; no fixed/sample codes or provider payloads in fixtures.

Implementation sequence:
1. Add strict C02–C05 contracts and additive schema with customer generation, purpose-specific challenge/delivery/attempt bindings, immutable identity history and one open manager case.
2. Implement scoped recovery context, card-present phone CAS, masked history and manager intake/read using current permissions, receipts and privacy-validated text.
3. Implement durable issue/verify/replacement state machine and thin routes. Reuse security and card resolution locks; retain historical links and purchases.
4. Prove every C02–C05 downstream bullet on real PostgreSQL: canonical uniqueness race; attestation; wrong target/purpose/session; attempts across resends; exact expiry; phone change; delivery crash and lost response; revocation; candidate claim and original upload races; rollback; consumed-authority replay; intake identity immutability.
5. Verify strict route error envelopes, permission conjunctions, pagination scope, no secret/phone audit projection, and staging/production configuration denial; write named verification record.
6. EM reruns final gates, dispatches three independent reviewers, resolves within cap, commits evidence and merges only with required CI green.

Final code, security and integrity verdicts PASS at reviewed_head; worktree clean and head unchanged after every review round.
Round 1 fixed canonical replacement audit references required by card review, PostgreSQL microsecond preservation and session expiry after lock waits. Nine new PostgreSQL regressions prove the full replacement-to-review path and expiry rollback.
Round 2 retained a P2 overbroad narrative filter; round 3 confirms harmless OTP/passport descriptions are accepted and sensitive value assignments rejected. No findings remain.
Independent pre-review tests reproduced a replacement/upload FK deadlock; compatible customer locking fixed it while preserving both receipt-order outcomes, immutable history and exact contribution.
EM final gates PASS: typecheck, lint (two pre-existing image warnings), 696 unit tests, production build, 744 real-PostgreSQL tests across 35 files with one worker, and timezone 5+5. All 45 recovery integration cases pass.
Earlier concurrent PostgreSQL runs hit variable-duration duplicate/operator timeouts; unchanged isolated baseline and feature suites passed, then the entire final suite passed without increasing timeouts or skipping cases. Named proof is in docs/qa/verification-2026-11-12-customer-recovery.md.
Local Chromium launch is blocked by the macOS sandbox. Required full integration and browser CI must pass before merge; no local browser pass is claimed.
Dispatch flag: 14 exceeds the high-tier advisory threshold of 8 due to independent adversarial coverage and two fix checks; review rounds remain within the explicit cap of 3. Earl requested no lane/STATUS/coverage edits, so this flag is recorded here and in Linear.
