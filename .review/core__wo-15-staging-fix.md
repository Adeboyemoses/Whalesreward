---
branch: core/wo-15-staging-fix
linear: WHR-28
tier: high
plan:
  goal: align staging source and runbook with console and accepted authentication
  files: .do/app.staging.yaml, docs/ops/staging.md, staging regression tests, lane and status and coverage records
  approach: attach managed pg cluster, document provider-owned IP header and Earl-only credentials, close accepted WHR-4
  tests: staging spec regression, typecheck, lint, unit, build and review validation
  risks: no cloud operations; empty secrets must never overwrite live settings; IP header requires trusted overwrite
---
