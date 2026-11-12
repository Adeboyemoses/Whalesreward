---
branch: core/wo-10-customer-recovery
linear: WHR-18
tier: high
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
