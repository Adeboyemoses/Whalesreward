---
branch: spec/WHR-139-stuck-holds
linear: WHR-139
tier: high
reviewed_head: 87c54d70ab594eca044bd215c2f22ae561cafc27
rounds: 2
builder: spec-em
reviewers:
  code-reviewer: PASS (round 2)
  security-reviewer: PASS (round 2)
  integrity-reviewer: PASS (round 2)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
plan:
  goal: Specify the narrow Q-557 two-person release exception with explicit pending recommendations
  files: docs/engineering/contracts/m3.md, docs/engineering/contracts/m3-audit-inventory.md, docs/engineering/proposals/evidence-policy.md, docs/engineering/decisions/INDEX.md
  approach: Preserve v1 and P-26, add guarded attested proposal and independent decision, protected immutable provenance and activation gate
  tests: Independent code security integrity review, scope and link checks, typecheck lint unit tests build and evidence validator
  risks: Self approval, evidence substitution, stale history, double credit, finalization races and mistaken activation
invariants: [I-05a, I-07, I-22, I-25, I-26, I-28, I-31, I-33, I-34, I-35, I-41, I-45a, I-46, I-48, I-51]
p1: ["fixed cross-target attestation consistency with locked common envelope and SR-02a"]
tickets: []
---
Q-557 specification only; detailed recommendations WHR-144–148 remain pending Earl.
Round 1 code and integrity found one shared INTEGRITY-P1: independent targets could use incompatible paper time ranges.
Round 2 requires a guarded same-sale common feasible envelope with all retained predicates, checked at proposal, approval, contribution and finalization.
The envelope supplies no sibling proof. SR-02a requires both-order and concurrent contradiction tests.
Code/security/integrity all PASS on 87c54d7; worktree clean and head unchanged after review.
EM gates: typecheck, lint (two inherited image warnings), 870 unit tests and production build passed before review.
Final-head gates and evidence validation are rerun before PR creation; CI independently gates merge.
No code, policy activation, product-docs write, STATUS, coverage-map or lane edits. Rook review/Earl acceptance remain separate.
