---
branch: spec/wo-3k-meter
linear: WHR-124
tier: high
builder: spec-em
reviewed_head: 194f493648ae7c533d743c1094d11a6d72da6e59
rounds: 2
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
invariants: [I-07, I-09, I-10, I-22, I-25, I-26, I-28, I-29, I-31, I-35, I-37, I-39, I-40, I-41, I-42, I-45a, I-46, I-48]
p1: []
tickets: []
plan:
  goal: Make approved P-26 meter reconciliation normative without runtime activation
  files: docs/engineering/contracts/{m3,operations}.md, docs/engineering/decisions/INDEX.md, docs/engineering/proposals/meter-reconciliation.md
  approach: Extend guarded price decisions with exact uniform-rate checks and immutable approved profiles; preserve P-22/P-25 boundaries
  tests: Exact rational worked examples and boundaries, paragraph/link checks, typecheck, lint, unit tests, build, three independent verdicts
  risks: Display tolerance must not become business tolerance or time evidence; policy activation and credit remain separately guarded
---

P-26 makes the approved uniform-rate, display-rounding-only meter rule normative.
The amendment specifies profiles, exact provenance, non-5xx domain errors and health semantics.
All three independent reviewers passed both rounds with no findings.
Round 2 refreshed evidence after required staging integration added T-19 to INDEX.
The P-26 amendment stayed unchanged; EM final-head gates passed again.
EM verification: typecheck, lint (two inherited image warnings), 689 unit tests and build PASS.
Exact rational arithmetic: 21 numeric fixtures and two T-10 calculations PASS.
Local links, diff whitespace and paragraph limit PASS; maximum prose paragraph 119 words.
MR-T1-01–20 are required future runtime cases, not implemented coverage.
No code, profile activation or cloud change is included. Q-559 remains pending.
Later base integration brought reviewed PR #119; no P-26 file changed and evidence remained valid.
