---
branch: core/wo-3-attendant-auth
linear: WHR-4
tier: high
reviewed_head: 93f3f87100800306273831c1cc3f6e389a15be10
rounds: 1
builder: backend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 4
invariants: [I-01, I-02, I-03, I-04, I-05, I-05a, I-06, I-09]
p1: []
tickets: [WHR-57]
plan:
  goal: Implement M1 attendant username sign-in, database sessions and revocation against m1.md including WO-spec-3a.
  files: prisma/**, src/server/auth.ts, src/server/lib/**, src/server/modules/auth/**, src/app/api/attendant/**, src/shared/contracts/**, tests/**, package.json, pnpm-lock.yaml, docs/engineering/**, docs/qa/**
  approach: Confirm T-13 one auth user with kind and separate profiles; keep recovery grants separate and deferred; wrap Better Auth with live database authority, immutable capture anchors, transactional replay and shared rate limits.
  tests: Real PostgreSQL credential and kind failures, immutable retry anchor and tombstones, concurrent sign-in, revocation and disable, reassignment, price refresh, 24-hour boundary, Origin, secure cookies, persistent throttling and signup denial; unit contracts and all EM gates.
  risks: Additive adapter schema and fixture hashing; concurrency must never renew anchors or revive revoked authority; proxy trust must fail closed; no phone queue, admin endpoints or cloud operations in scope.
---

## Implementation sequence
1. Read M1 common rules and the three auth endpoints, data-model auth/context constraints, F01 and TRD authentication/reassignment. Preserve the capturing sign-in as the WO-spec-3a lower bound.
2. Add failing contract/integration cases before implementing schema and Better Auth adapter/configuration. Public signup is unavailable; only fictional seeded attendants may authenticate. Use the existing immutable UUIDv7 identities and profile separation (T-13 confirmed by this work-order plan).
3. Implement thin sign-in, session and sign-out routes over typed strict schemas and auth services. Store replay comparison as secret HMAC, never password/digest; serialize concurrent attempts; five-minute replay with at least 24-hour tombstones; retain durable contexts after logout.
4. Enforce live account/kind/version/revocation checks, same-origin mutations, host-only HttpOnly Secure SameSite=Lax cookies, no-store envelopes, generic credential errors and durable token buckets with configured trusted-proxy handling. Preserve acknowledged assignment and anchor on reads/retries; expose reassignment and current price without rewriting history.
5. Test each acceptance rule, including changed retry body, expired replay, missing assignment, wrong kind, malicious Origin, simultaneous retries and revoked replay. Apply migrations from scratch and repeat fixture seeding safely. Record named invariant tests in coverage map.
6. EM independently runs typecheck, lint, unit, build, integration and applicable browser gates. Three diff-scoped reviewers run in parallel; fix within three rounds, commit evidence, merge only after all CI checks pass. Post READY and stop; WHR-28 remains READY.

Engineering configuration defaults remain centralized and documented, not client policy. Admin roles, recovery execution, sync/credit and the phone's offline machinery are outside this slice.

## Verification and review
- Round 1: code/security/integrity PASS at 93f3f87; reviewer worktree/head checks unchanged. No blockers or P1s. Security P2 bucket-cardinality growth tracked in WHR-57; not expanded into this scope.
- EM independently ran typecheck, lint, unit 77/77, production build, fresh-database migrations, integration 65/65 and time 3/3 in UTC plus America/New_York: PASS.
- EM real HTTP Playwright auth flow: 1/1 PASS, exercising actual Next routing, secure cookie jar, signup denial and logout revocation.
- Full local browser command attempted; macOS sandbox blocks Chromium MachPort startup before assertions. Full browser CI, including the real login/account/logout test, is required before merge.
- Better Auth 1.7.17 is MIT; a narrow transaction-bound adapter preserves existing identity/session tables. No public signup or admin authentication implemented.
- A26 lockout/admin-unlock wording differs from normative M1 temporary rate limiting; M1 governs. No new board parity, cloud operation or full offline/sync acceptance claimed.
