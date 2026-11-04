# Attendant authentication

WO-core-3 / WHR-4 implements the three M1 attendant authentication endpoints. The public interface is `docs/engineering/contracts/m1.md`; Better Auth is an internal username-authentication provider. No public Better Auth catch-all route or signup endpoint is exposed.

## Runtime configuration

- `DATABASE_URL`: PostgreSQL connection, using the existing deployment TLS configuration.
- `BETTER_AUTH_URL`: exact application origin. HTTPS is required except for local `localhost` or `127.0.0.1` development. Do not include credentials, a path, query or fragment.
- `BETTER_AUTH_SECRET`: server-only random secret, at least 32 characters. The existing staging deployment spec already supplies this name. Never paste its value into logs, docs or test evidence.
- `WHR_TRUSTED_IP_HEADER`: optional single-IP header overwritten by a trusted reverse proxy. Leave unset until that proxy behavior is verified. Unconfigured requests share a conservative unknown-IP bucket; arbitrary forwarded headers do not bypass limits. Do not configure a header the client can control or a comma-separated forwarding chain.

Engineering defaults live in `src/server/modules/auth/config.ts`: database sessions last seven days; the capture window is exactly 24 hours; successful sign-in replay lasts five minutes; expired keys remain tombstones for at least 24 hours. These defaults do not settle the client's future admin-session policy. A live session after the capture window expires does not authorize new capture or upload; it only permits the session read without renewing the anchor.

## Local fixtures and staging

`pnpm db:seed` creates fictional station, assignment and staff fixtures. Local development can provision the documented fictional credential in `prisma/seed-auth.ts`. For staging, credential provisioning requires a separately supplied `WHR_SEED_ATTENDANT_PASSWORD`; there is no public default staging password. Seed inserts missing credentials and never resets an existing password. No admin login is provisioned by this work order.

Staging provisioning and data changes remain Earl-authorized operations under the existing staging runbook. This work order performs neither. Production rejects fictional credential seeding. Never reuse a local fixture password for a deployed service.

## Identity and history

The response's account ID is `attendant.id`, not the underlying authentication user ID. Sign-in loads a current assignment and creates an immutable capture context. Session reads retain that assignment and sign-in anchor while signalling reassignment; a current price may be returned for future captures on the acknowledged product. Logout revokes the session without deleting capture history or browser queues. WO-spec-3a continues to use the original capturing sign-in as its lower time bound.

Same-key replay revalidates credentials and live authority before reissuing the existing session cookie. Changed content conflicts, expired retry keys fail, and revoked sessions cannot be recreated by replay. Cookies are host-only, Secure, HttpOnly and SameSite=Lax; API responses are no-store and contain no session credential.

Verification: `docs/qa/smoke-2026-11-05-attendant-auth.md`. Browser offline-window enforcement belongs to WO-app-2; upload and credit enforcement belongs to WO-core-4/WO-app-3.
