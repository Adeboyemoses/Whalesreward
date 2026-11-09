---
branch: spec/wo-3c-numeric-corrections
linear: WHR-84
tier: high
plan:
  goal: configure P-22 numeric-only retained-photo corrections in the M3 specification
  files: docs/engineering/contracts/m3.md, docs/engineering/decisions/INDEX.md, docs/engineering/coverage-map.md, docs/agentic/lanes/spec.md, STATUS.md
  approach: amend existing policy and correction sections, log WHR-47 decision, preserve other gates and record READY on green staging merge
  tests: EM typecheck lint unit build, evidence validator, paragraph length and local link checks, independent code security integrity reviews
  risks: broader edits or basis switching, invalid evidence, stale bases, late or recovered proposals must gain no new authority
---

Plan recorded before the specification amendment and independent review.
