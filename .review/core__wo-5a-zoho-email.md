---
branch: core/wo-5a-zoho-email
linear: WHR-66
tier: high
reviewed_head: a9c8efde9765a21f62b280d1a7305a1f3b04c611
rounds: 2
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 9
invariants: [I-12, I-13, I-41]
p1: ["fixed invalid production email configuration now exits startup with code 1"]
tickets: []
plan:
  goal: Enable environment-configured staging Zoho CPaaS email only for approved test inboxes.
  files: src/server/adapters/email*, src/server/modules/admin-access/config.ts, src/server/modules/admin-access/mail.ts, src/server/lib/*, src/instrumentation*, prisma/seed*, prisma/fixtures.sql, tests/integration/*, jobs/admin-mail.ts, Dockerfile, .dockerignore, docs/ops/staging.md, .env.example
  approach: Preserve delivery outcomes; validate EU HTTPS config at startup, enforce exact staging allowlist and test markings, bound requests without replaying uncertain sends, add insert-only staging seed email and bundle existing bounded mail worker for Earl-run delivery.
  tests: Local HTTP stub payload/auth/response and timeout tests; recipient and production guards; secret-free failures; real PostgreSQL seed insert-only and recovery regressions; local runtime worker proof; standard EM gates.
  risks: Recovery links and provider credentials must never enter logs or audit; redirects and unsafe endpoints must not disclose credentials; seed reruns must not rewrite identity or verification.
---

High tier raised for recovery delivery and secrets. No cloud or real-provider calls.
Runtime configuration only; public fixtures use example.com and synthetic tokens.
The provider decision and shared session records are separate PRs.

Provider decision is T-15 because T-14 already records authentication.
Independent test engineer added four PostgreSQL worker-to-stub adversarial cases.
All three reviewers passed both rounds; EM runtime smoke found a P1 between rounds:
Next caught the startup exception and kept listening with HTTP 500 responses.
The fix exits with code 1 and a fixed safe message; red-to-green unit and compiled-server
process regressions cover empty/populated production allowlists and private-output exclusion.
EM final typecheck, lint, unit 185, build, PostgreSQL/MinIO 137 and Linux browser 98 pass.
Four existing staging-only browser skips; no retries. Native compiled startup also exits 1.
One existing sync test hit its unchanged 5s limit during concurrent image/browser builds;
focused rerun and complete isolated integration rerun passed without code or timeout changes.
Runtime worker packaging and non-root image exclusions verified locally; no provider calls.
Zero automatic retries preserve uncertain-link revocation. Real inbox acceptance is Earl-run.
Feature dispatch flag 9 exceeds the high-tier guide of 8; review rounds 2 remain within cap 3.
