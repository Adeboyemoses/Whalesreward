# M1 server sync verification

WO-core-4 / WHR-6. Backend verification accompanies READY; this is not a claim of phone acceptance or permission to change cloud resources.

## Automated acceptance

Run from the reviewed worktree with an isolated local PostgreSQL database, migrations applied, and local MinIO running. Use the existing fictional compose credentials through the test harness; never read or paste environment files, auth cookies, storage keys or presigned URLs.

1. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
2. Run `pnpm test:integration --reporter=verbose` and retain output for the named lost-response retry, concurrent finalize and adversarial evidence tests. Each uses real PostgreSQL. The adversarial test must PUT different bytes through the original staging permission after acceptance and prove final bytes/digest/revision remain unchanged.
3. Run `pnpm exec playwright test -c tests/storage/playwright.config.ts` against local MinIO: actual Chromium Blob PUT succeeds at the signed length and a wrong-length body is denied. Trace/video/screenshots are disabled so signed URLs are not captured.
4. Run `pnpm test:time` under its two configured timezones and `pnpm test:e2e` against a local server/database.
5. Run the evidence validator on the final head; record independent code/security/integrity verdicts and all CI checks before merge.

## Storage behavior to verify

- Only a random staging key is presigned. The permission is PUT-only, expires after five minutes, and signs the JPEG Content-Type and exact original byte length. The browser supplies Content-Length automatically; the app sends only the returned Content-Type header.
- Normal MinIO HTTP is allowed only for local development; staging uses the configured HTTPS Spaces origin and its private bucket. No CDN, public ACL or client write access to final keys.
- The browser sends only the returned headers. The existing staging CORS rule permits its exact app origin, PUT/GET/HEAD and Content-Type; no ETag response header is needed.
- Finalize bounds downloaded bytes and image decoding, validates SHA-256 and immutable metadata, writes the validated buffer under a final key, then rechecks live authority and commits the revision/audit once.
- Transport failure remains retryable; invalid evidence remains uncredited with the original retained. Retry cannot clear a hold.

## Earl's deployed staging smoke

After the automatic staging deployment is healthy, use only the fictional attendant/customer and an in-app photo of a fictional meter. The upload UI belongs to WO-app-3; run its phone flow when that client slice is on staging.

1. Sign in online and look up the same printed code by text and QR. Expect the same name/category, no phone number.
2. Capture and save a fictional sale; wait for the upload. Expect a credited server receipt only after finalize succeeds, or the applicable held status with no credit.
3. Inspect only request statuses (do not copy URLs/cookies): upload-permission 200, direct storage PUT 200, finalize 200/202 followed by settled status. A browser CORS failure must leave the photo queued.
4. Retry/reload after completion and confirm one purchase and one accepted revision. A P-18 interval spanning a relevant change must remain held.

Cloud credentials and bucket/CORS changes remain Earl-run through docs/ops/staging.md. Automated MinIO/signing checks establish adapter behavior; an actual authenticated Spaces PUT/finalize is a separate deployed smoke result and must be reported explicitly.
