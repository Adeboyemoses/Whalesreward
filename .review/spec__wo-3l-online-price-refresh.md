---
branch: spec/wo-3l-online-price-refresh
linear: WHR-125
tier: high
builder: spec-em
plan:
  goal: Specify additive online pump-price refresh for new drafts without rewriting sales or capture bounds
  files: docs/engineering/contracts/{m1,m2}.md, docs/engineering/decisions/INDEX.md
  approach: Capability-gated lookup snapshot plus existing session price; monotonic context-bound adoption; keep and warn on composed drafts
  tests: Compatibility and race acceptance matrix, paragraph and link checks, typecheck, lint, unit tests, build, three independent verdicts
  risks: Late responses must not roll back price or cross accounts; refresh is not trusted capture evidence or renewed offline authority
---

Saved high-tier plan for WHR-125. Specification only; no runtime implementation.
