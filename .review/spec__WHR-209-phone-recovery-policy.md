---
branch: spec/WHR-209-phone-recovery-policy
linear: WHR-209
tier: high
reviewed_head: 289ffe62f5f172c95328f84c7ba6797c84f9cead
rounds: 2
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
plan:
  goal: specify approval-gated OTP and independently proven original-phone recovery
  files: docs/engineering/contracts/m3.md, docs/engineering/contracts/operations.md, docs/engineering/decisions/INDEX.md, docs/engineering/decisions/technical.md
  approach: preserve built HMAC and atomic semantics; recommend bounded delivery and enrolled device proof; separate policy readiness from runtime activation
  tests: EM typecheck lint unit build; document links and scope checks; independent code security integrity review
  risks: SMS pumping and duplicate dispatch; cloned device identifiers; queue loss; recommendations mistaken for approval
invariants: [I-06, I-07, I-09, I-19, I-21, I-22, I-26, I-33, I-36, I-41]
p1: ["fixed immutable capture-context enrollment binding", "fixed nonce and sign-out proof exceptions", "fixed audit digest contradiction"]
tickets: []
---
Specification only; M3/operations and T-23. No code, cloud/provider action, real phone numbers or shared-record edits.
Provider choice is settled; numeric/security/device recommendations await Rook review then Earl approval.
Round 1: code/security/integrity found P1 contradictions in proof bootstrap, capture provenance and audit digests.
Round 2: all three independently PASS at reviewed_head, no findings or open blockers.
Immutable server capture context binds exact enrollment/version/account/station before capture-ready sign-in; no legacy backfill.
Public nonce issuance and no-data authority reduction are exempt; protected queue/authority uses keep fresh proof.
Manifest digests remain in protected recovery records; existing closed general-audit schema remains.
EM final-head gates: typecheck PASS; lint PASS (0 errors, 4 inherited image warnings).
Unit suite PASS (997 tests, 104 files) with --maxWorkers=1; production/Workbox build PASS.
Initial default-worker run had four five-second timeouts in offline-sync and CLI tests; reduced-worker full runs passed unchanged.
New relative links/fragments PASS (9); changed-path allowlist and phone-literal scan PASS; diff --check PASS.
No integration/e2e gate triggered: no runtime code, schema or implemented user flow changed.
Future OTP/recovery acceptance cases are obligations, not runtime coverage claims.
Open needs:human: WHR-212 OTP, WHR-213 sender, WHR-214 budget, WHR-215 device/process; WHR-48 remains intake-only.
Issuance/unlock remain denied pending accepted policy, later reviewed implementation and private execution acceptance.
