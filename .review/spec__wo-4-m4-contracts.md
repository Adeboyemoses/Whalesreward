---
branch: spec/wo-4-m4-contracts
linear: WHR-51
tier: high
builder: spec-em
plan:
  goal: Specify M4 rankings, finalization, reports, overview and settings for parallel implementation.
  files: docs/engineering/contracts/m4.md, docs/engineering/data-model.md, docs/engineering/coverage-map.md, docs/agentic/lanes/spec.md, STATUS.md
  approach: Reuse M1-M3 protocols; exact accepted-revision totals; serialized immutable snapshots; explicit unresolved policy gates.
  tests: EM typecheck, lint, unit, build, paragraph and contract consistency checks; independent code/security/integrity review.
  risks: Capture/deadline ambiguity, stale reconciliation, changed permissions, export precision, unintended retention deletion.
---
Plan saved before drafting and independent review. No code, migrations, prize fulfilment, product-doc edits or cloud operations.
