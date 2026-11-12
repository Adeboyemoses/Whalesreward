---
branch: spec/wo-3k-meter
linear: WHR-124
tier: high
builder: spec-em
plan:
  goal: Make approved P-26 meter reconciliation normative without runtime activation
  files: docs/engineering/contracts/{m3,operations}.md, docs/engineering/decisions/INDEX.md, docs/engineering/proposals/meter-reconciliation.md
  approach: Extend guarded price decisions with exact uniform-rate checks and immutable approved profiles; preserve P-22/P-25 boundaries
  tests: Exact rational worked examples and boundaries, paragraph/link checks, typecheck, lint, unit tests, build, three independent verdicts
  risks: Display tolerance must not become business tolerance or time evidence; policy activation and credit remain separately guarded
---
