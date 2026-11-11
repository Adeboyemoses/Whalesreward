---
branch: spec/wo-3j-meter-proposal
linear: WHR-112
tier: high
plan:
  goal: propose exact meter reconciliation for WHR-50 without normative or runtime changes
  files: docs/engineering/proposals/meter-reconciliation.md, docs/engineering/coverage-map.md, docs/agentic/lanes/spec.md, STATUS.md
  approach: compare historical interval and tolerance choices, retain evidence and revision safeguards, register questions
  tests: EM typecheck lint unit build, exact worked arithmetic, paragraph and link checks, unchanged m3.md
  risks: false temporal inference, excessive tolerance, stale correction overwrite, implicit policy activation
---

Plan saved before independent code, security and integrity review. Proposal only; no builder dispatch or application changes.
