---
branch: spec/wo-3m-audit-catalogue
linear: WHR-130
tier: high
builder: spec-em
plan:
  goal: Reconcile M3 audit actions and fields with every current writer and identify WO-core-11 fixes.
  files: docs/engineering/contracts/m3.md, docs/engineering/contracts/m3-audit-inventory.md, docs/engineering/coverage-map.md, docs/agentic/lanes/spec.md, STATUS.md
  approach: Read-only writer inventory, closed action-specific shapes, privacy and historical mapping, independent three-role review.
  tests: EM typecheck, lint, unit tests, build, paragraph and link checks, exhaustive writer/action inventory.
  risks: False historical attribution, leaked private evidence, missed writers, changed credit semantics, operational approval mistaken for runtime activation.
---

Plan saved before independent review. Specification only; no implementation or deployment authority.
