---
branch: spec/wo-3g-duplicate-rule
linear: WHR-102
tier: high
builder: spec-em
plan:
  goal: specify P-24 advisory duplicate detection without changing credit
  files: docs/engineering/contracts/m3.md, docs/engineering/contracts/operations.md, docs/engineering/decisions/INDEX.md
  approach: define exact pair predicates, settlement and revision triggers, bounded continuation, window validation and protected health status; log P-24
  tests: contract consistency, paragraph limit, typecheck, lint, unit tests, build and independent code/security/integrity reviews
  risks: phone time leaking into eligibility, duplicate pair races, dropped capped pairs, health disclosure and implicit policy activation
invariants: [I-25, I-28, I-29, I-35, I-40, I-41, I-45a, I-52]
---

Plan recorded before specification review. No code, migration or product-document edits.
