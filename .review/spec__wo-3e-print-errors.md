---
branch: spec/wo-3e-print-errors
linear: WHR-99
tier: high
plan:
  goal: preserve the UI explanation for missing print layout through the platform edge
  files: docs/engineering/contracts/m2.md
  approach: change print_layout_unconfigured to 409, document edge-safe domain errors, inventory remaining contracted 5xx codes for Rook
  tests: contract inventory and paragraph checks, typecheck, lint, unit tests, build, independent code/security/integrity review
  risks: other mappings remain pending review; runtime implementation belongs to WO-core-7c
---
