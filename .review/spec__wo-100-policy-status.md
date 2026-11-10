---
branch: spec/wo-100-policy-status
linear: WHR-100
tier: high
reviewed_head: 81be23937a4a819ffd2b6bac70f9b5588c6598ba
rounds: 2
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
plan:
  goal: Remap ten domain errors to 409 and specify private per-policy health status without weakening gates.
  files: docs/engineering/contracts/m1.md, m2.md, m3.md, m4.md, operations.md
  approach: Amend endpoint tables and shared rules in place; define named health flags with a public aggregate and live settings permission for details.
  tests: Status inventory, paragraph limit, typecheck, lint, unit tests, build and independent code/security/integrity review.
  risks: Status drift, configuration disclosure, false readiness and accidental authorization or credit changes.
invariants: [I-07, I-09, I-12, I-20, I-22, I-26, I-27, I-35, I-36, I-45, I-46, I-49]
p1: ["fixed terminal export retry ambiguity in M2 and M4"]
tickets: []
---
Specification only. Runtime implementation remains WO-core-7d and the respective M3/M4 work orders.

Round 1 found one P1: older lifecycle text could restart a terminal failed export. M2/M4 now permit bounded internal retries only before terminal failure; new preparation requires new operation and export IDs. All three reviewers passed round 2 at the reviewed head. Worktree stayed clean and head unchanged during both rounds.

EM validation: typecheck, lint, 536 existing unit tests and build pass. Inventory verifies ten remaps across 21 explicit endpoint occurrences, three retained 503 codes across four occurrences, ten policy keys and maximum prose paragraph length 119 words. No new runtime behavior or test coverage is claimed.
