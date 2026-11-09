# WHR-92 s02 export investigation

Source: approved staging smoke commit `db7c15c`, isolated worktree `app/wo-6a-m2-smoke`. No production source changes. Local production Next build, isolated fictional PostgreSQL database `whr_app6_s02_repro`, and real local MinIO through `createCardArtifactStorage`. No staging data, cloud changes, secret files or client-check relaxations.

## Results

- **6 passed, 0 failed, 0 skipped, zero retries (35.8 seconds):** PDF and XLSX from Generated, Printed and Active batches. Each case executes unchanged `adminRequest`, `CustomerAdminApi.commit/read`, shared export schemas and `customerFile`; a transport-only bridge uses Playwright's authenticated local HTTP context and preserves actual response bytes, status, content type and envelope. Preparing before/after readiness retains one export; Generated/Printed cases additionally replay the original preparation after the next lifecycle transition and retain historical snapshot version/status. Poll/list schema checks and protected file MIME/signature checks pass. Files deserialize, Excel contains reserved codes, and export count, batch lifecycle and inventory checks pass.
- **1 passed, 0 failed, zero retries (13.6 seconds):** existing actual production UI test `I-20 prepared PDF and XLSX downloads contain reserved snapshot codes without lifecycle side effects`. Linux Chromium downloaded both formats through unchanged browser code; PDF parsing, independent QR decoding against reserved inventory, Excel parsing and unchanged lifecycle passed.
- **3 passed, 0 failed, zero retries (4.8 seconds):** existing actual UI lost-transition/export retry and malformed successful export response cases (truncated JSON and null envelope). These confirm retained original operation/snapshot after actual server acceptance and delayed or unreadable transport.
- Scoped ESLint and TypeScript checks passed for the new producer.

API producer command:

```sh
DATABASE_URL=postgresql://whr:whr@127.0.0.1:5433/whr_app6_s02_repro pnpm exec playwright test --config tests/customers-cards/s02.config.ts
```

Browser tests use `tests/customers-cards/playwright.config.ts` with the desktop project and grep `I-20 prepared PDF and XLSX downloads`, then `lost transition|malformed successful export`. Native macOS Chromium was blocked before execution by sandbox MachPortRendezvous permission denial. A local Linux Playwright browser server in image `whr-upload-browser:lean` was connected by `use.connectOptions`; a loopback TCP proxy forwarded browser requests to the host production server. The app used the successfully built host artifact and `pnpm start`, avoiding a different application build. Temporary harness failures (missing login idempotency header and a TypeScript Buffer/BodyInit mismatch) were corrected before export assertions; they are not product failures.

## Boundary trace and conclusion

`cardsWrite` stores the requested format and reviewed batch version in the immutable export snapshot; `exportView` parses its prepare/poll/list representation with `cardExportSchema`. `CustomerAdminApi.commit` verifies batch ID, requested format and reviewed snapshot version. The protected file route returns the artifact's expected content type; `customerFile` verifies MIME and `%PDF-` or ZIP local-file signature before release.

**The reported s02 invalid_response was not reproduced.** No failing receipt, schema or binary check was found in this fresh production-build matrix. This is not evidence that Earl's staging incident is fixed and does not establish a server-side cause. An authenticated staging reproduction must capture which boundary failed and the non-sensitive response fields/status/MIME/signature, with the deployed build ID and the browser's running build, before assigning a source fix. The service-worker deploy handover remains WHR-90 scope; this report does not assume it caused s02.
