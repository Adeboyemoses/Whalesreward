---
branch: core/WHR-179-phone-exclusion-uniqueness
linear: WHR-179
tier: high
reviewed_head: 6657d1e38dbf7424a0618d0f073f6b70bd9b2e86
rounds: 1
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 5
plan:
  goal: prevent multiple applicable phone-unavailable exclusions for an incomplete purchase
  files: src/server/modules/giveaway/**, tests/**, docs/engineering/contracts/**
  approach: validate source uniqueness under existing security reporting and campaign locks at proposal or approval and revalidate at certification and preparation without changing historical evidence or generic errors
  tests: exact two-phone sequence, concurrent conflicting exclusions, already-saved duplicates, non-superuser PostgreSQL and real HTTP routes
  risks: historical evidence must remain immutable; stale or superseded exclusions must not cause false conflicts; no data cleanup or policy activation
invariants: [I-26, I-46, I-07]
p1: []
tickets: []
---
WHR-179 isolated fix; WHR-178 and draft PR 164 remain parked.

Round 1: code, security and integrity reviewers independently passed the same code head with no findings.
Each reviewer and the EM independently ran the four PostgreSQL regressions successfully.
The tests cover the exact two-phone sequence, concurrent approvals, historical duplicates through real HTTP, and replacement census applicability.
All tested mutation calls use a non-superuser without BYPASSRLS; native triggers remain enabled.
No history was rewritten, no migration or cleanup added, and no operational policy activated.
