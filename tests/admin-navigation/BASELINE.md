# Admin navigation local regression baseline

WO-app-4a / WHR-75. Test source head `6a16dc1`; unchanged application source from `6072636`. This is a local production-build regression baseline, not the required staging timing baseline. No production code changed.

Local Linux Docker image `whr-upload-browser:lean`, Node 26.12.0, Chromium, PostgreSQL 16; fresh disposable database `whr_admin_nav_test`. No cloud/staging APIs used, no private configuration copied. Traces, videos and automatic failure screenshots are disabled. Each account/password is fictional and generated per test. The browser tests use real sign-in and server data; route interception holds or rejects session responses only to make the race deterministic.

Desktop, one worker, zero retries: **4 failed, 1 passed (26.7 seconds)**.

| Test | Baseline result |
|---|---|
| I-07 admin section and detail navigation preserve the document and session shell | FAIL: document sentinel disappears on Users → Roles; full document navigation confirmed |
| I-07 admin tab return retains visible data while session revalidation is pending | FAIL: Portal users is absent while the real successful session response is held |
| I-09 admin background failure retains content but definitive revocation removes it | FAIL: transient refresh failure removes the authorized page before revocation assertions are reached |
| I-09 returning visibility revalidates access without waiting for a focus event | FAIL: visible event produces no session request |
| I-49 admin navigation does not persist its account or grants in browser storage | PASS: fresh admin context has no local/session storage, IndexedDB or CacheStorage entries |

Typecheck and lint pass. The passing storage control is not permission to persist any admin state in the fix. Further changed-account/stale-response and inline-detail coverage will accompany the implementation once the EM confirms staging measurement is complete.

## Re-run

Runner `whr-admin-navigation-tests` is retained idle with frozen dependencies in `/verify`. A tracked archive is the only copied input; no private runtime files are used.

```sh
git archive HEAD | docker exec -i whr-admin-navigation-tests tar -xf - -C /verify
docker exec -w /verify \
  -e DATABASE_URL=postgresql://whr:whr@host.docker.internal:5433/whr_admin_nav_test \
  whr-admin-navigation-tests sh -c 'pnpm db:migrate:deploy && pnpm test:e2e tests/e2e/admin-navigation.spec.ts --project desktop --workers=1 --retries=0'
```

Database credentials above are public local Compose fixtures. Native host Chromium is unavailable in this sandbox. Do not point this suite at staging or production. The ordinary default Playwright configuration also collects the new spec for both existing projects.
