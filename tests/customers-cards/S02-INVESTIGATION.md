# WHR-92 s02 export investigation

Source: approved staging smoke commit `db7c15c`, isolated worktree `app/wo-6a-m2-smoke`. No production source changes. Local production Next build, isolated fictional PostgreSQL database `whr_app6_s02_repro`, and real local MinIO through `createCardArtifactStorage`. No staging data, cloud changes, secret files or client-check relaxations.

## Resumed diagnosis: non-OK HTML transport after committed prepare

Rook's latest [WHR-92 clarification](https://linear.app/phaneum/issue/WHR-92) identifies Prepare/PDF on a Generated batch as the failing action. The edge/deploy explanation remains a hypothesis; no live edge response, cloud activity log or staging database was inspected by this checker.

The new browser regression `I-20 committed PDF preparation followed by 502 HTML stays unavailable and retries the same snapshot` reproduces a concrete **client classification defect**. It uses ten fictional cards in a real Generated/version-1 batch and the actual local production prepare endpoint. The route first fetches the real 202 success and verifies the durable PDF export row, then substitutes a 502 `text/html` gateway response solely at the browser transport boundary. Before checking copy, the test verifies exactly one export and ten immutable snapshot items.

Against unchanged client source `170f9e9e80408ca2667474e20f0275954a665390`, the targeted Linux Chromium run reported **1 failed, 0 passed, zero retries**. It failed at `tests/e2e/customers-cards.spec.ts:1027`: expected zero “The result could not be verified” notices, received one. `adminRequest` attempts JSON decoding before checking HTTP success, so unreadable non-OK bodies become `invalid_response`. This is distinct from the existing valid-success receipt/schema/MIME/signature validation, which remains required.

The producer requires unavailable copy with “do not assume it failed”, the existing uncertain/same-confirmation notice, disabled cancellation and no fresh-export review before reconciliation. Retrying must preserve the exact operation/body and server export ID, leave exactly one unchanged snapshot, and retain Generated/version-1 inventory. The existing malformed successful JSON/null regressions remain unchanged. Green verification waits for the separately built client fix; no production code was written by this checker.

Red command, with app and test runner together in a fresh local Linux container:

```sh
docker exec -w /app -e DATABASE_URL=postgresql://whr:whr@127.0.0.1:5433/whr_app6_s02_502_red whr-app6a-s02-red pnpm exec playwright test --config /full-config.mts --project desktop --grep 'committed PDF preparation followed by 502 HTML' --workers=1 --retries=0 --reporter=line
```

The runner uses `whr-upload-browser:lean`, a tracked `git archive` of the unchanged source plus only the new test file, locked dependency installation, the existing loopback-only Compose proxy, and a successful `pnpm build`. `/full-config.mts` imports the repository base and customers/cards configs, uses their real fixture setup and environment, and changes only server startup to reuse the production artifact (`pnpm start --hostname 127.0.0.1`). Host typecheck and scoped ESLint passed. No assertion, timeout or retry policy was weakened.

## Initial normal-response matrix results

- **6 passed, 0 failed, 0 skipped, zero retries (35.8 seconds):** PDF and XLSX from Generated, Printed and Active batches. Each case executes unchanged `adminRequest`, `CustomerAdminApi.commit/read`, shared export schemas and `customerFile`; a transport-only bridge uses Playwright's authenticated local HTTP context and preserves actual response bytes, status, content type and envelope. Preparing before/after readiness retains one export; Generated/Printed cases additionally replay the original preparation after the next lifecycle transition and retain historical snapshot version/status. Poll/list schema checks and protected file MIME/signature checks pass. Files deserialize, Excel contains reserved codes, and export count, batch lifecycle and inventory checks pass.
- **1 passed, 0 failed, zero retries (13.6 seconds):** existing actual production UI test `I-20 prepared PDF and XLSX downloads contain reserved snapshot codes without lifecycle side effects`. Linux Chromium downloaded both formats through unchanged browser code; PDF parsing, independent QR decoding against reserved inventory, Excel parsing and unchanged lifecycle passed.
- **3 passed, 0 failed, zero retries (4.8 seconds):** existing actual UI lost-transition/export retry and malformed successful export response cases (truncated JSON and null envelope). These confirm retained original operation/snapshot after actual server acceptance and delayed or unreadable transport.
- Scoped ESLint and TypeScript checks passed for the new producer.

API producer command:

```sh
DATABASE_URL=postgresql://whr:whr@127.0.0.1:5433/whr_app6_s02_repro pnpm exec playwright test --config tests/customers-cards/s02.config.ts
```

The producer was then expanded to ten fictional reserved cards per batch, with a required multi-page PDF. **6 passed, 0 failed, 0 skipped, zero retries (32.2 seconds)** across the same format/lifecycle matrix. This start-only rerun used the already verified production artifact. The temporary `.mts` config imported `tests/customers-cards/s02.config.ts`, set absolute `testDir` and `globalSetup` to the original directories, and overrode only `webServer.command` to `pnpm start --hostname 0.0.0.0` and `webServer.cwd` to the worktree root; all environment, schema, transport, quota and assertion settings were inherited unchanged.

Browser tests use `tests/customers-cards/playwright.config.ts` with the desktop project and grep `I-20 prepared PDF and XLSX downloads`, then `lost transition|malformed successful export`. Native macOS Chromium was blocked before execution by sandbox MachPortRendezvous permission denial. A local Linux Playwright browser server in image `whr-upload-browser:lean` was connected by `use.connectOptions`; a loopback TCP proxy forwarded browser requests to the host production server. The app used the successfully built host artifact and `pnpm start`, avoiding a different application build. Temporary harness failures (missing login idempotency header and a TypeScript Buffer/BodyInit mismatch) were corrected before export assertions; they are not product failures.

## Initial boundary trace and conclusion (before transport probe)

`cardsWrite` stores the requested format and reviewed batch version in the immutable export snapshot; `exportView` parses its prepare/poll/list representation with `cardExportSchema`. `CustomerAdminApi.commit` verifies batch ID, requested format and reviewed snapshot version. The protected file route returns the artifact's expected content type; `customerFile` verifies MIME and `%PDF-` or ZIP local-file signature before release.

**The reported s02 invalid_response was not reproduced.** No failing receipt, schema or binary check was found in this fresh production-build matrix. This is not evidence that Earl's staging incident is fixed and does not establish a server-side cause. An authenticated staging reproduction must capture which boundary failed and the non-sensitive response fields/status/MIME/signature, with the deployed build ID and the browser's running build, before assigning a source fix. The service-worker deploy handover remains WHR-90 scope; this report does not assume it caused s02.
