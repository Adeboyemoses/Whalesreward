# Attendant authentication verification

WO-core-3 / WHR-4. Backend acceptance against `docs/engineering/contracts/m1.md`, including WO-spec-3a. Written before implementation verification. Run only against a disposable local database with fictional fixtures. No cloud provisioning or staging reseed is authorized by this runbook.

## Automated acceptance

1. Set `DATABASE_URL` for the disposable local PostgreSQL database, then run `pnpm db:migrate:deploy`. Expect every migration to apply successfully from a blank database.
2. Run `pnpm test:integration`. Expect the authentication tests to prove username/password validation, generic unknown/disabled/wrong-kind failures, configured assignment handling and database session revocation (A01/A26).
3. Confirm the same suite proves concurrent identical sign-in attempts return one session/context, retry never renews the anchor, changed payload conflicts, expired retry keys fail, and revoked sessions cannot be replayed (A01/A18).
4. Confirm session reads preserve the original assignment/context and sign-in time, signal reassignment, expose the acknowledged product's current price, and never extend the 24-hour offline expiry (A12). Historical capture contexts survive logout and reauthentication, preserving the WO-spec-3a lower bound.
5. Confirm sign-out clears the cookie and revokes the session; repeated or stale-cookie sign-out is harmless. A different attendant receives only their own context (A12/A13). Browser outbox isolation remains the separate WO-app-2 client responsibility.
6. Confirm strict inputs, Origin rejection, no-store responses, host-only Secure/HttpOnly/SameSite cookies, credential-free JSON, persistent token buckets and Retry-After are tested. Public sign-up must be unavailable.
7. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, then `pnpm test:e2e`. Record exact outcomes and any environment limitation in the review evidence and READY comment.

## Interpretation and limits

- A26's board mentions account lockout requiring an admin. The normative M1 contract specifies temporary token-bucket throttling and Retry-After; this backend follows that contract and does not add an admin unlock policy.
- A01/A12/A13 are behavior references. This backend work order claims no new screen parity or real-phone acceptance.
- Successful authentication supplies the phone's anchor; it does not itself implement browser clock checks, queue upload, sale acceptance or loyalty credit.
- Secrets remain outside this document and tool output. Runtime configuration names and local fixture setup are documented with the implementation; real passwords and cookies must never be pasted into verification records.
