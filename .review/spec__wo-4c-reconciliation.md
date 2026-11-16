---
branch: spec/wo-4c-reconciliation
linear: WHR-156
tier: high
reviewed_head: c69dee2f6b1bf31b61aeea4a9ec1599b30d87ba2
rounds: 2
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
plan:
  goal: specify P-30 reconciliation, phone checks and exclusions, and trusted photo receipt for WO-core-12
  files: docs/engineering/contracts/m4.md, docs/engineering/data-model.md, docs/engineering/contracts/m3-audit-inventory.md, docs/engineering/contracts/operations.md, docs/engineering/decisions/INDEX.md
  approach: amend M4 in place with strict versioned records, existing permission recommendations, registry validation, immutable receipts and serialized snapshot guards; distinguish settled policy from Earl confirmations
  tests: EM typecheck, lint, unit tests, build, link and paragraph checks; independent code, security and integrity specification review
  risks: unknown phone-only queues, authority assumptions, receipt backdating, pending P-29 proposals and stale reconciliation must never bypass readiness or rewrite snapshots
invariants: [I-07, I-09, I-11, I-22, I-25, I-26, I-28, I-35, I-40, I-41, I-45, I-45a, I-46, I-48]
p1: ["fixed partial-upload ambiguity with WHR-162 confirmation gate and blocking default", "fixed frozen exclusion detail projection"]
tickets: []
---
Specification only. No code, STATUS, coverage-map or lane-file edits.

Code, security and integrity independently PASS at the reviewed head in round 2.
Round 1 found two P1 specification gaps: partially uploaded sales on a lost phone,
and absence of frozen proposal context for the independent approver.
WHR-162 now records exact-ID Option A and blocking Option B/default, pending Earl.
The immutable exclusion detail includes census/account/timing/policy/source pins.
WHR-158 separately gates authority; Q-576 names remain missing. No live activation.
EM verification: typecheck PASS; lint PASS (two inherited img warnings);
893 unit tests PASS; production build PASS; relative links/anchors,
modified prose bounds and git diff --check PASS.
No runtime M4 coverage or board parity claimed. No code or session-record edits.
