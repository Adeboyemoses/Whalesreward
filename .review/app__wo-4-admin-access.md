---
branch: app/wo-4-admin-access
linear: WHR-9
tier: high
reviewed_head: 66980288bd627f2529bc6e7d14ad43b9c72ea750
rounds: 2
builder: frontend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 14
plan:
  goal: implement admin access screens on WO-core-5 APIs with server authority
  files: src/app/(admin)/**, src/client/admin*, src/ui/**, src/styles/app.css, tests/**, docs/briefs/**, docs/qa/**
  approach: no-store cookie APIs, memory-only drafts and link tokens, explicit review and confirm, live server permissions
  tests: local Postgres and Mailpit Playwright flows, revocation and refusals, unit client errors, board fidelity at 1440 and usability at 390
  risks: secret exposure, stale authority and versions, uncertain mutations, cross-account state, delivery confusion
invariants: [I-07, I-08, I-09, I-10, I-11, I-12, I-13, I-41, I-49]
p1: [fixed frozen role grants and affected users in review, fixed restricted-session logout, fixed same-tab recipient navigation and stale responses]
tickets: [WHR-69, WHR-70]
---
Admin access screens call existing M2 APIs with no-store and server authority.
Runbook and plan were committed before builder dispatch; five UI briefs followed.
Round 1 code P1s fixed in the isolated fix branch; round 2 all reviewers PASS at reviewed_head.
UUIDv7 requests, recipient replacement/replay and restricted logout are browser-tested.
Independent test-engineer report covers 24 boards with 32 sanitized captures.
H07 remains a permission reference; WHR-69/70 record nonblocking differences.
EM final-head typecheck, lint, unit 189 and production build PASS.
EM exact-source Linux full browser 100 PASS, four existing staging-only skips, no retries.
EM final-head real PostgreSQL/Mailpit suite 4 PASS, zero skips/failures (27.8 seconds).
No server/schema, cloud, staging-data or shared record edits in this feature PR.
Dispatch flag exceeded; two formal rounds remain within high-tier cap three.
Earl's staging smoke and real allowlisted inbox acceptance remain pending.
