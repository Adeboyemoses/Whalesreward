---
branch: core/wo-5a-zoho-email
linear: WHR-66
tier: high
plan:
  goal: Enable environment-configured staging Zoho CPaaS email only for approved test inboxes.
  files: src/server/adapters/email*, src/server/modules/admin-access/config.ts, src/server/modules/admin-access/mail.ts, src/server/lib/*, src/instrumentation*, prisma/seed*, prisma/fixtures.sql, tests/integration/*, jobs/admin-mail.ts, Dockerfile, .dockerignore, docs/ops/staging.md, .env.example
  approach: Preserve delivery outcomes; validate EU HTTPS config at startup, enforce exact staging allowlist and test markings, bound requests without replaying uncertain sends, add insert-only staging seed email and bundle existing bounded mail worker for Earl-run delivery.
  tests: Local HTTP stub payload/auth/response and timeout tests; recipient and production guards; secret-free failures; real PostgreSQL seed insert-only and recovery regressions; local runtime worker proof; standard EM gates.
  risks: Recovery links and provider credentials must never enter logs or audit; redirects and unsafe endpoints must not disclose credentials; seed reruns must not rewrite identity or verification.
---

High tier raised for recovery delivery and secrets. No cloud or real-provider calls.
Runtime configuration only; public fixtures use example.com and synthetic tokens.
T-14 and shared session records are separate PRs.
