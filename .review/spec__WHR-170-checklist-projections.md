---
branch: spec/WHR-170-checklist-projections
linear: WHR-170
tier: high
reviewed_head: ae4c0e5e22f41846ede44f77ca7700a029902da3
rounds: 3
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 9
plan:
  goal: specify truthful nine-check outcomes and narrow P-30 selection reads
  files: docs/engineering/contracts/m4.md, docs/engineering/decisions/INDEX.md, docs/engineering/decisions/technical.md
  approach: extend WHR-22 with live and immutable stored projections, scoped selectors, exact authority and stale-view rules; preserve WHR-158 and WHR-162
  tests: typecheck, lint, unit tests, build, contract and link inspection, independent code/security/integrity review
  risks: inferred photo absence, historical account omission, alias-person approval, stale pages and accidental certification
invariants: [I-06, I-07, I-09, I-11, I-26, I-28, I-35, I-40, I-41, I-45, I-45a, I-46, I-49]
p1: []
tickets: []
---
Specification only. No application code, runtime policy activation, STATUS, coverage-map or lane edits.

All three independent reviewers passed the final source head. Round 1 found one P2:
Owner+settings+sales could select a new manager without reading the current designation.
Fixed with a narrow currentDesignation before-value, independently of eligible choices.
Round 2 passed; round 3 confirmed only a Markdown table-delimiter escape.
Dispatch flag: 9 exceeds the high-tier flag of 8 because that final markup check used all three reviewers.
No open findings or deferred tickets. Plan remained unchanged throughout review.
EM final source gates passed: typecheck, lint (two inherited image warnings),
100 unit files / 966 tests, and build. All 30 local links/anchors and six endpoint
table rows checked; diff check passed. No server/schema/user-flow implementation changed,
so local integration/e2e were not required; PR CI remains mandatory before merge.
Stored/live distinction, conservative historical account coverage, trusted-byte absence,
canonical person/privacy, no business read audit, protected paging and same-key history
were inspected against WHR-22 b4dcc7b and the approved design brief.
Specification only; no runtime certification or policy activation.
Q-576 real people and Rook review/Earl acceptance remain separate prerequisites.
No STATUS, coverage-map or lane edits, as explicitly requested.
