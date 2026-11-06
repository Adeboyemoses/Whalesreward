# WHR-75 review regressions

Local real-PostgreSQL/Chromium evidence only. No staging requests, GUI, external inbox, retained traces, tokens or response bodies. Fictional fixtures use contract-valid UUIDv7. No server permission changes.

The non-mail tests remain in ordinary CI: `tests/e2e/admin-navigation-mutations.spec.ts` (five cases). Only genuine enqueue/verification continuations use `tests/admin-navigation/mutations/playwright.config.ts` with the local Mailpit provider (five cases). No skips or provider/CI configuration changes.

## Before fixes

Frozen runtime `d184a3c` (same runtime as `4e87ed7`; d184 only changes agent guidance): all five non-mail cases fail. Real successful user and custom-role PATCH responses leave “Not saved yet”; failed history/picker secondary reads replace the editor with a fabricated queued-delivery view; held PATCH completion sends the browser back to the departed record. The initial combined run reported eight failures, but only the first five are valid regression evidence: the default no-op email provider correctly returned 503 for the mail prerequisites. That refusal is not an application defect.

With the genuine local Mailpit provider and expected enqueue status 202, the three initial mail cases on `d184a3c` reported **2 failed, 1 passed (16.9 s)**. Held verification-follow-up GET rewrites the departed route; normal queued acknowledgement is lost when the suffix changes. Held initial send to a different route passed and remains a guard test. One preparatory fixture attempt used UUIDv4 and was rejected by the UUIDv7 contract; that run is not application regression evidence. A preparatory mail assertion expected HTTP 200; corrected to contract HTTP 202 before the reported mail run.

## First fix

Runtime `44a101f`, final split tests: ordinary CI subset **14 passed, 0 failed, 0 skipped (13.0 s)**, comprising the five non-mail regressions plus previous eight navigation cases and one default admin-access case. Local typecheck/lint passed. The first three mail regressions also pass.

Extending verification departure to the same record exposed a remaining view-lifetime bug. After a successful queue acknowledgement, hold either Resend POST or its follow-up GET; click Back to user; release the response. Both reopen `/verification-sent`. Mail suite: **3 passed, 2 failed, 0 skipped (18.3 s)**. Sent to the frontend builder; no production code edited by the test engineer.

A clean rerun of the final five-case default file directly on frozen `d184a3c` confirms **5 failed, 0 passed, 0 skipped**. It excludes all mail prerequisites and preparatory fixture/assertion mistakes.

## Final fix and rerun

Runtime fix `6c0915c`, merged test source `71e13e4`: ordinary default subset **14 passed, 0 failed, 0 skipped (14.9 s)**; dedicated new Mailpit continuation suite **5 passed, 0 failed, 0 skipped (9.3 s)**. Local typecheck/lint passed. Tests prove two sequential real saves each with incremented database versions, one immutable history row per reason and no document reload; secondary warnings preserve the editor and cannot invent role choices; late PATCH/send/follow-up callbacks cannot rewrite another route or the same record's Back destination; queued acknowledgement survives its own suffix transition, while direct reload says delivery without fabricating a new queue acknowledgement.

The last fixes change mutation completion, secondary-error presentation and the verification view suffix only. No new performance measurement was made. Existing BEFORE/AFTER evidence remains explicitly measured on `6072636` / `4e87ed7`; it is not a claim about this later head or deployed staging.

### Reproduce

Use the retained named Linux runner and local Compose services. The mutation database has seven migrations. For a fresh run, create a separate local database and deploy migrations before these tests; the tests add fictional records without deleting prior history. Public local fixture credentials only:

```sh
git archive HEAD | docker exec -i whr-admin-navigation-tests tar -xf - -C /verify
docker exec -w /verify -e DATABASE_URL=postgresql://whr:whr@host.docker.internal:5433/whr_admin_nav_mutations whr-admin-navigation-tests pnpm test:e2e tests/e2e/admin-navigation-mutations.spec.ts tests/e2e/admin-navigation.spec.ts tests/e2e/admin-access.spec.ts --project desktop --workers=1 --retries=0
docker exec -w /verify -e DATABASE_URL=postgresql://whr:whr@host.docker.internal:5433/whr_admin_nav_mutations -e MAILPIT_URL=http://mailpit:8025 whr-admin-navigation-tests pnpm exec playwright test -c tests/admin-navigation/mutations/playwright.config.ts
docker exec -w /verify -e WHR_ADMIN_TEST_DATABASE_URL=postgresql://whr:whr@host.docker.internal:5433/whr_admin_browser_nav_review_final -e WHR_ADMIN_TEST_ROOT_DATABASE_URL=postgresql://whr:whr@host.docker.internal:5433/whr_dev -e MAILPIT_URL=http://mailpit:8025 whr-admin-navigation-tests pnpm exec playwright test -c tests/admin-access/admin-access.config.ts
docker exec -w /verify -e DATABASE_URL=postgresql://whr:whr@host.docker.internal:5433/whr_admin_nav_parity_review whr-admin-navigation-tests pnpm exec playwright test -c tests/design-parity/admin-navigation/playwright.config.ts
```

The existing dedicated suite creates its own isolated local database with its migration ledger; do not pre-apply Prisma migrations to that fresh database. Parity uses a fresh seeded local database for two then three admins/one Owner role. Do not replace any of these URLs with staging or production.

Final unchanged existing auth/recipient Mailpit suite: **4 passed, 0 failed, 0 skipped (25.8 s)** on `6c0915c`. Focused H01/H04/H05/H08 desktop/phone parity recapture: **2 passed, 0 failed, 0 skipped (6.6 s)**, eight screenshots updated and independently inspected against the read-only boards/prior comparison. No new visual regression; inherited WO-app-4 limitations remain. See [focused parity report](../../design-parity/admin-navigation/REPORT.md). All requested regression evidence is now complete; EM owns final full-head gates and independent review.
