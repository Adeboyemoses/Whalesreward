# Customer recovery verification — WO-core-10

Scope: WHR-18, M3 C02–C05, invariants I-15, I-19, I-21, I-21a, I-33 and I-41.
Backend verification only; screens and device smoke belong to WHR-19.

## Acceptance checklist

| Contract requirement | Required proof |
|---|---|
| Recovery context | Current masked phone and active card/version from one scoped snapshot; customers AND recovery; no cards permission needed |
| Card-present phone change | True in-person attestation, canonical equality/uniqueness, stale customer/card denial, concurrent uniqueness race, same customer/category/card/provenance/purchases |
| Changes history | Masked phones, immutable actor/time/result, scoped pagination, customers permission, no raw contact in central audit |
| Verification configuration | Production and staging fail closed with 409 phone_verification_unconfigured; only test injection can configure the adapter |
| Durable delivery | One intent per generation; same-key retry does not send twice; failed/uncertain delivery revokes authority; resend supersedes verified-unused challenges |
| Verification bindings | Wrong target, purpose, issuer/session, generation, customer/card version, expiry and attempts all deny; constant-time keyed HMAC comparison |
| Durable attempts and limits | Failed attempt commits despite 422; retry counts once; changed code conflicts; cumulative customer/purpose and actor/IP limits survive resend |
| Lost responses | Historical nonsecret verification and replacement results replay after live authorization; no expiry renewal or recreated authorization |
| Revocation | Phone/card change, resend, logout/session revocation and permission removal stop use |
| Replacement | Active unused candidate only; old card/link/customer/challenge CAS; complete rollback on candidate loss or audit failure; one consumption |
| Historical sales | Old card retired permanently; historical customer/card preserved; concurrent original upload observes replacement review without credit |
| Manager intake | Exact customer version, one open case, protected notes, read permission alternatives; no identity mutation or approval/token |
| HTTP and privacy | Strict bodies and IDs, scoped foreign-object 404, Origin, request limits, non-5xx domain errors except delivery_unavailable; no raw code, destination or provider response in logs/audit/health/fixtures |

## Verification results

EM verification at bf0ba00:

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build`: PASS; 73 unit files / 695 tests. Lint has two pre-existing image warnings, zero errors.
- `DATABASE_URL=<local disposable PostgreSQL> pnpm test:integration --maxWorkers=2`: PASS; 34 files / 735 tests. The 36 new PostgreSQL cases comprise 5 service/schema, 5 HTTP and 26 independent adversarial cases.
- `pnpm test:time`: PASS; 5 tests in UTC and 5 in America/New_York.
- All 21 migrations applied from scratch and fictional seed completed in a dedicated local database.
- `pnpm test:e2e --max-failures=1`: local browser launch blocked by macOS sandbox (`MachPortRendezvousServer`, permission denied). Required browser CI must pass before merge; no local browser pass is claimed.

An earlier unrestricted parallel integration run timed out in existing duplicate-continuation and operator-cleanup tests while build/browser gates competed. A complete 731-test rerun passed with two workers; after adding four delivery tests, the final complete 735-test rerun also passed. No timeout or application assertion was weakened.

## Named C02–C05 proof

All names below are real-PostgreSQL tests under `tests/integration/`.

| Required downstream bullet | Test file and names |
|---|---|
| Canonical phone uniqueness race | `customer-recovery-adversarial.test.ts`: “I-15 concurrent canonical phone changes assign one customer and preserve the losing identity” |
| Card-present attestation and preserved account | `customer-recovery-http.test.ts`: “rejects Origin, oversized/malformed bodies, extra fields, missing attestation and malformed routes”; `customer-recovery.test.ts`: “card-present phone change preserves identity and historical receipt; intake never changes identity” |
| Wrong target/purpose/session | Adversarial: “I-21a a challenge for another customer is unavailable and cannot consume attempts”, “I-21a a second session of the same admin cannot replay or consume verification”, “I-21a changed %s binding denies verification with no identity change” (phone/card/generation/expiry); service: “purpose-bound phone verification cannot consume an email challenge” |
| Attempts/resends and expiry | Adversarial: “I-21a failed attempts commit once and a correct final permitted attempt can replace”, “I-21a resend revokes verified unused authority and preserves cumulative customer send limits”, “I-21a attempts across generations cannot evade the cumulative verification limit”; changed-binding expiry case |
| Phone change, logout and permission revocation | Adversarial: “I-21a session revocation and phone change invalidate unused verified authority”, “I-09 permission removal while confirmation waits prevents consumption”; service: “rechecks live issuer permission between durable intent and dispatch, before adapter invocation” |
| Lost delivery/response | Adversarial: “I-21a delivery %s fails closed durably and same-key retry never resends” (reject/throw), “I-21a an expired abandoned delivery lease is revoked on retry without another dispatch”, “I-21a lost issuance response replays the original nonsecret receipt without a second send” |
| Candidate claim and original upload races | Adversarial: “I-19 replacement and registration cannot claim the same candidate card”, “I-33 %s race preserves historical identity and credits only cards valid at receipt” (replacement-first/receipt-first) |
| Atomic rollback and consumed-authority replay | Adversarial: “I-21 audit failure rolls back retirement links customer version and challenge consumption”, “I-21a verification and consumed replacement replay preserve historical results without renewing authority”, “I-21a consumed replacement replay remains scoped to the issuing session” |
| C04 never changes identity | Adversarial: “I-21a concurrent manager intakes create one protected case without changing identity or verification authority”; HTTP: “intake is protected, accepts manager read but never manager-only intake, and rejects sensitive notes” |
| Privacy, protected history and fail-closed configuration | Adversarial: “I-41 recovery audit and receipts contain no raw verification code phone or private intake narrative”, “I-21a %s rejects the test adapter before delivery” (staging/production); HTTP: “history is masked and cursor binds customer, actor and action”, “fails closed before issuance and retains the strict no-store error envelope” |

The receipt-first concurrency test reproduced a PostgreSQL deadlock before the customer lock changed to `FOR NO KEY UPDATE`. The same interleaving now preserves the permanent customer/card identity and credits only a card valid at first receipt. Replacement-first is held with zero spend. Delivery-crash testing terminates only its isolated test backend after the intent commits and proves the expired lease cannot send again.

Migration SQL is additive and was applied to isolated PostgreSQL schemas and validated against the Prisma model. It was authored directly rather than generating unrelated baseline foreign-key drift. Existing email verification constraints and tests remain in the full regression suite.

## Round-one review corrections

At 4befee0, replacement audit targets the retired card and includes immutable customer/replacement IDs consumed by the existing evidence resolver. PostgreSQL timestamp text retains microseconds in retirement, links, challenge consumption, identity history and audit. Authorization is refreshed after customer/card/challenge lock waits. Narrative validation allows harmless verification descriptions while rejecting sensitive values.

`customer-recovery-review-regressions.test.ts` adds nine PostgreSQL cases: “replacement produces authoritative evidence that resolves a queued old-card hold and restores credit”; “preserves same-millisecond PostgreSQL receipt-before-replacement ordering without false card hold”; absolute/idle expiry behind the card lock; context/intake/issue/verify expiry behind the customer lock; and “verification rechecks issuer expiry after a challenge row lock and writes no attempt”. The actual review service resolves the hold and restores credit; the retired card stays retired. All 45 recovery integration cases pass in the EM full run.

EM gates at 4befee0: typecheck, lint, build, 696 unit tests and timezone 5+5 pass. The full local PostgreSQL run reached 741/744 passing; the unchanged bulk-duplicate suite timed out and had two follow-on failures. Its isolated rerun also timed out, so a staging-baseline comparison is being recorded separately. No timeout was increased and no failed test was skipped. Local browser execution remains blocked by the same macOS launch denial. Required full integration and browser CI must pass before merge; final review/CI results belong in the committed review evidence.

## Release boundary

WHR-49 still decides the phone provider and security policy. The deployed adapter remains unconfigured; this work does not activate SMS delivery. WHR-48 owns final manager decisions; WHR-115 owns stranded queues. STATUS, coverage and lane files are excluded by Earl's session instruction.
