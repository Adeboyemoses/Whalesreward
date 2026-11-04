---
branch: spec/wo-3a-amendment
linear: WHR-52
tier: high
reviewed_head: db57c09bf5f44bd407d7e32fefa4802b292613f0
rounds: 2
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 6
invariants: [I-05a, I-26, I-28, I-31, I-34, I-35, I-36, I-37, I-38, I-39, I-41, I-45a]
p1: ["fixed explicit nullable recovery admin references with authorship constraints"]
tickets: []
plan:
  goal: specify Earl's bounded capture interval and independent recovered-correction review
  files: docs/engineering/contracts/{m1,m3}.md, data-model.md, decisions, coverage-map.md, lane and STATUS
  approach: amend existing rules in place and retain unrelated policy gates
  tests: typecheck, lint, unit, build, paragraph length and independent three-domain review
  risks: false time authority or recovery self-approval could grant unsupported credit
---

Three independent reviewers PASS after two rounds. Code-review P1 fixed with explicit nullable admin FKs, server derivation and immutable authorship-dependent constraints.
EM typecheck, lint, 18 unit tests, build, diff whitespace and prose-length checks pass.
High tier raised above medium routing. Documentation only; no implemented invariant or board parity claim.
