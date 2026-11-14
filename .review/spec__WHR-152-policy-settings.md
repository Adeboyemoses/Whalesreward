---
branch: spec/WHR-152-policy-settings
linear: WHR-152
tier: high
plan:
  goal: declare staging duplicate-window settings and document every health policy gate
  files: .do/app.staging.yaml, docs/ops/staging.md
  approach: add only the two approved plain web runtime variables; inventory existing policy evaluators and document owners, missing-setting behavior and diagnostic limits; file application diagnostics for T1
  tests: compare parsed staging spec against base for unchanged existing variables; check all health policy names in the runbook; typecheck, lint, unit tests, build and independent code/security/integrity review
  risks: missing policy configuration can silently disable duplicate flags; health readiness is not policy activation; never include secret values or alter existing variables
invariants: [I-40]
---

WHR-152 is limited to configuration and operations documentation. No application code,
cloud operations, STATUS, coverage-map or lane changes are authorized in this PR.
