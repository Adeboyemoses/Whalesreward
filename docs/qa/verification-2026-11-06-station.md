# WO-core-6 backend verification

Part of WHR-10. Backend only; WO-app-5 supplies the later staging screen smoke.

EM verified production source `71b7f0f` on 6 November 2026. Databases were dedicated
local fixtures; PostgreSQL 16 and MinIO were real services. Linux Chromium used a
git archive of that exact committed source, Node 26.12.0 and the frozen lockfile.

| Command | Actual result |
|---|---|
| `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | PASS; 248 unit tests, no lint warnings, production build and Workbox worker built |
| `pnpm db:migrate:deploy` | PASS; all seven migrations applied to a fresh EM database |
| `pnpm test:integration` | 13 files, 170 tests passed; zero failed or skipped |
| `pnpm test:time` | Three tests passed under UTC and three under America/New_York |
| `pnpm test:e2e` (Linux Chromium) | 104 passed, four existing staging-only skips; zero failed or retried |
| `pnpm exec playwright test -c tests/storage/playwright.config.ts` | One passed; signed browser Blob upload and wrong-length refusal |

Named output command:

```sh
pnpm exec vitest run --project integration tests/integration/station-management.test.ts tests/integration/station-adversarial.test.ts --reporter=verbose
```

Actual output, 19 passed, zero failed/skipped, 3.73 seconds:

```text
PASS I-32 creates a unique pump, derives product and replays the original result
PASS I-32 concurrent price activations have one winner and never rewrite old price versions
PASS I-32 precision-only activation is versioned; no-change, overflow and stale confirmations do not write
PASS I-01 first password sessions cannot capture; completion revokes and fresh sign-in creates the first context
PASS first password accepts bounded multibyte credentials, rejects bad proof and oversized bodies without exposing secrets
PASS I-05 concurrent reassignments close one interval; fresh sign-in acknowledges new pump without rewriting old context
PASS I-09 disabled accounts lose live session and cannot accept new assignments
PASS P-20 price activation inside=true capped [S,U] uses immutable original context and actual price history
PASS P-20 price activation inside=false capped [S,U] uses immutable original context and actual price history
PASS P-20 assignment change inside=true capped [S,U] preserves old queue ownership and attribution
PASS P-20 assignment change inside=false capped [S,U] preserves old queue ownership and attribution
PASS I-07 pump, attendant and price picker grants never imply attendant account creation
PASS I-07 a grant removed while a station write waits for the security lock cannot authorize its commit
PASS I-07 replay reauthorizes the actor before returning an old successful station receipt
PASS I-07 station cursors cannot cross endpoints or attendant-search filters
PASS I-07 station HTTP rejects cross-origin, oversized, extra-field and invalid exact-rate requests without caching
PASS I-01 attendant provisioning cannot reuse an admin username or leave partial credentials and assignments
PASS I-05 configured-assignment reads never acknowledge a new pump or rewrite an existing capture context
PASS I-04 restricted first-password sessions have no capture context and cannot use configured assignment or sync
```

Acceptance checks: atomic attendant and initial assignment creation; unique normalized
names/usernames and immutable codes; first-password restrictions; price races and
precision-only changes; stale versions and replay; live permission revocation;
configured versus acknowledged assignment and unchanged old capture contexts;
P-20 price and assignment changes inside and outside [S, U], including late receipt
with U capped at the original offline expiry; disabled-account rejection; no sale
or price history rewrite. Domain changes must audit actor/reason/server time.

Scope boundary: M2 and the pump/attendant decision notes exclude pump editing and
deactivation and attendant status/reset endpoints. WHR-76 records the broader
wording in WHR-10 for Earl to resolve; no disputed operations were added. Existing
disabled-account rejection is tested. No scope extension is inferred from silence.

WHR-77 tracks the app integration for restricted attendant first-password responses;
the backend contract is specified in M2, but the current attendant UI does not yet
render that new state. WO-app-5 supplies prices/assignment staging screen acceptance.
No UI parity, cloud operation, staging-data change or client policy approval claimed.
