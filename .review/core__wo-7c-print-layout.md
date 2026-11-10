---
branch: core/wo-7c-print-layout
linear: WHR-99
tier: high
plan:
  goal: expose missing print layout as an actionable 409 and a value-free health flag
  files: src/server/modules/cards/**, src/server/modules/health/**, tests/**, .do/app.staging.yaml, docs/qa/**
  approach: implement merged m2 contract; share layout validity for health; add explicit staging-only placeholder with Q-553 comment; preserve all other error mappings
  tests: missing and invalid PDF layout return JSON 409 retryable false without mutations; Excel remains available; health validity and non-disclosure; staging placeholder and full repository gates
  risks: optional print configuration must not fail overall database health; placeholder awaits Q-553; no cloud operations or leaked layout values
---
Prerequisite spec PR #98 merged at 112da2e. Review pending. No STATUS/coverage/lane edits.
