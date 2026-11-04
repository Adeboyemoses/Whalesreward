---
branch: core/wo-15-staging
linear: WHR-28
tier: high
plan:
  goal: prepare reproducible staging deployment and an Earl-run provisioning runbook without cloud operations
  files: .do/app.staging.yaml, Dockerfile, .dockerignore, next.config.ts, src/app/api/health/**, src/server/adapters/**, src/app/layout.tsx, src/app/dev/gallery/page.tsx, tests/**, docs/ops/staging.md, docs/qa/smoke-2026-11-04-staging.md, docs/engineering/coverage-map.md, docs/agentic/lanes/core.md, STATUS.md
  approach: same pinned non-root Docker image for web and migration/seed jobs; PG16 dev database; runtime-only secrets and staging safeguards; no-op email; step-by-step console runbook
  tests: health success and redacted bounded failure; staging/production banner, noindex and gallery separation; no-op email; idempotent fixtures; all EM gates; local Docker build and runtime checks
  risks: no doctl or cloud operations authorized; provider validation and HTTPS/redeploy proof remain pending Earl; no backups on dev DB; rollback must retain compatible schema; never bake secrets into images
---

Plan saved before builder dispatch. Approval and detailed acceptance criteria: WHR-28.
One platform builder owns deployment config, supporting health/staging code, tests and runbook.
EM owns smoke steps, coverage and session records, evidence, git and Linear.
No CI change, auth implementation, production deployment, provider setup or live data.
