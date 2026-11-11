---
branch: spec/wo-3i-review-evidence
linear: WHR-110
tier: high
plan:
  goal: Make approved EP-1 through EP-5 Option A normative as review-evidence-v1
  files: docs/engineering/contracts/m3.md, docs/engineering/contracts/operations.md, docs/engineering/proposals/evidence-policy.md, docs/engineering/decisions/INDEX.md
  approach: Amend M3 in place with closed resolvers, sufficiency, strict configuration and durable provenance; preserve errors and guards; add protected health flag and P-25
  tests: Typecheck, lint, unit, build, paragraph/link checks, exact downstream T1 verification matrix, independent code/security/integrity review
  risks: Interval boundaries, stale guards, policy races, circular proof and disclosure; no runtime activation or WHR-50/Q-557 scope
---

Plan saved before specification drafting and independent review.
