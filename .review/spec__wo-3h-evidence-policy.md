---
branch: spec/wo-3h-evidence-policy
linear: WHR-103
tier: high
plan:
  goal: propose evidence admissibility for price, card, date and capture without activating policy
  files: docs/engineering/proposals/evidence-policy.md, docs/engineering/coverage-map.md, docs/agentic/lanes/spec.md, STATUS.md
  approach: bounded server facts, per-kind sufficiency and exclusions, versioned configuration, protected health, client questions
  tests: EM typecheck/lint/unit/build; prose limit, local links, unchanged m3; independent code/security/integrity review
  risks: circular evidence, invented capture time, unsupported cancellations, cross-sale references, accidental policy activation
invariants: [I-05a, I-07, I-22, I-25, I-26, I-28, I-31, I-33, I-34, I-35, I-41, I-45a, I-46, I-48]
---

Proposal only. High tier retained from WHR-103 despite docs-only routing.
