---
branch: core/wo-15-staging
linear: WHR-28
tier: high
reviewed_head: 2b14b3fd1028efde36367b6ef089c17f03555c28
rounds: 3
builder: platform-engineer
reviewers:
  code-reviewer: PASS (round 3)
  security-reviewer: PASS (round 3)
  integrity-reviewer: PASS (round 3)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 11
plan:
  goal: prepare reproducible staging deployment and an Earl-run provisioning runbook without cloud operations
  files: .do/app.staging.yaml, Dockerfile, .dockerignore, next.config.ts, src/app/api/health/**, src/server/adapters/**, src/app/layout.tsx, src/app/dev/gallery/page.tsx, tests/**, docs/ops/staging.md, docs/qa/smoke-2026-11-04-staging.md, docs/engineering/coverage-map.md, docs/agentic/lanes/core.md, STATUS.md
  approach: same pinned non-root Docker image for web and migration/seed jobs; PG16 dev database; runtime-only secrets and staging safeguards; no-op email; step-by-step console runbook
  tests: health success and redacted bounded failure; staging/production banner, noindex and gallery separation; no-op email; idempotent fixtures; all EM gates; local Docker build and runtime checks
  risks: no doctl or cloud operations authorized; provider validation and HTTPS/redeploy proof remain pending Earl; no backups on dev DB; rollback must retain compatible schema; never bake secrets into images
invariants: [I-48]
p1: ["fixed explicit deployment job entrypoint and strict Prisma TLS dialect"]
tickets: []
---

Prepared staging configuration and Earl-run runbook without provider operations.
Supporting runtime implementation includes src/proxy.ts and scripts/deploy/entrypoint.mjs; operational health contract is documented in the same PR.
Round 1 P1 fixed: DigitalOcean job commands explicitly invoke the entrypoint because run_command replaces Docker ENTRYPOINT.
Prisma CLI receives its strict TLS dialect separately from pg; both reject wrong hostnames and untrusted CAs in actual image checks.
Round 2 passed at 0045c5b. Round 3 passed after staging PR #20 integration touched the shared coverage-map path; core source unchanged.
After docs-only spec PR #21 merged, operational coverage was moved to the final READY docs PR. This implementation PR no longer changes the shared coverage file; every remaining non-evidence PR path is unchanged from reviewed_head.
EM typecheck, lint, unit 27/27, integration 49/49 and production build passed on the final combined head.
EM amd64 Docker build, non-root/excluded-root-path assertions and offline Prisma CLI passed.
Actual overridden migration, seed twice, four TLS negative cases, staging HTTP health/gallery/banner/noindex and production gallery isolation passed independently.
Local full browser suite attempted: 6 Chromium startup failures (macOS MachPort permission), 4 mode-specific skips; no application assertion failed. Required browser CI must pass before merge.
Request-only staging header tests passed 2/2. No CI workflows changed.
Not run: doctl/provider spec validation, cloud creation, deployed HTTPS smoke or next-merge redeploy proof; Earl performs these using docs/ops/staging.md.
Dispatch flag: 11 exceeds the high-tier flag of 8 due to the fix and shared-file staging synchronization; rounds remain within cap 3.
