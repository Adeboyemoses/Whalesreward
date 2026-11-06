---
branch: core/wo-5c-zoho-response
linear: WHR-73
tier: high
reviewed_head: e506d8f82831d67a1e717c35e261e2e1e3d31c31
rounds: 1
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 5
invariants: [I-12, I-41, I-52]
p1: []
tickets: [WHR-74]
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

All three independent reviewers passed the unchanged code head without findings.
Builder red-to-green evidence: diagnostics26fail/4controls, acknowledgement precedence2fail, independent PostgreSQL7fail/1control before correction.
EM typecheck/lint/build, 245 unit tests, 151 PostgreSQL/MinIO tests and Linux browser104/four existing staging-only skips PASS.
Compiled prefix refusal and real SIGTERM tests pass without any provider call. Only exact200/201 plus EM_104 succeeds; failure data stays allowlisted and bounded.
An earlier builder run had one inherited I-03 boundary-test failure; unchanged builder and EM full reruns passed. WHR-74 tracks investigation separately; no sync rule or retry policy changed.
