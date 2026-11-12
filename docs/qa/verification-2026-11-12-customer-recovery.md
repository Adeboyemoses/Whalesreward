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

Implementation verification pending. Baseline at 36c98bd: 689 unit tests and 699 real-PostgreSQL tests passed.

## Release boundary

WHR-49 still decides the phone provider and security policy. The deployed adapter remains unconfigured; this work does not activate SMS delivery. WHR-48 owns final manager decisions; WHR-115 owns stranded queues. STATUS, coverage and lane files are excluded by Earl's session instruction.
