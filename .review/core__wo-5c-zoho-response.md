---
branch: core/wo-5c-zoho-response
linear: WHR-73
tier: high
plan:
  goal: Recognize Earl-confirmed US Zoho acceptance and expose bounded secret-free diagnostics for failed admin email without weakening staging guards or replaying links.
  files: src/server/adapters/email*, src/server/modules/admin-access/mail-runtime*, src/instrumentation*, tests/integration/*mail*, tests/e2e/*email*, docs/ops/staging.md, .codex/agents/backend-engineer.toml
  approach: Allow only exact US/EU CPaaS URLs, accept only HTTP 200 or 201 with EM_104, reject prefixed tokens, emit one allowlisted failure event per send and one startup state event per process while preserving existing leases and production gates.
  tests: Red-to-green 201 and US endpoint regressions; every failure reason and safe setting/provider-code shape; canary privacy and hostile response cases; singleton startup reasons; real PostgreSQL single-attempt acceptance and revocation; EM full gates and actual startup checks.
  risks: Provider bodies and credentials must never escape into logs; diagnostic parsing must retain byte/time bounds; no retries, arbitrary endpoints, production activation or cloud operations.
---

High tier for verification/reset delivery and the escape-to-test agent gotcha.
Earl's direct API evidence is the acceptance contract; no real provider calls or private configuration is needed.
Technical decision and shared READY records are separate PRs.
