# WO-app-3 upload and receipt smoke

Status: READY on reviewed green staging merge of app/wo-3-uploads. Earl approved WHR-7 on 5 November 2026. WHR-5 remains READY pending its phone smoke.

Automated verification uses the contract-shaped fake through the typed adapter. It does not prove real server credit or physical Android operation. Full M1 phone exit requires WO-core-3/4 endpoints and the deployed staging HTTPS app with real private Spaces storage.

## Primary route: staging HTTPS and real Spaces

Before starting, record the staging App Platform URL from Earl’s deployed app as `STAGING_URL` below; the repository does not contain its hostname. Use that exact HTTPS origin throughout. Confirm WO-core-4 is deployed, `/api/health` reports the intended commit and `db: ok`, and the staging banner is visible. Follow [staging operations](../ops/staging.md) for existing fictional credentials and private `whr-staging-evidences` bucket/CORS setup. Do not enable HTTP fakes, intercept API responses, or use MinIO for this acceptance run. Missing real endpoints or fixture cards block the M1 exit; they do not fail the client-only READY delivery. No cloud configuration or reseeding is part of this runbook.

1. On Android Chrome, open `STAGING_URL/attendant/sign-in` over HTTPS, allow the in-app camera, and install/open the PWA if offered. Expected: online sign-in (A01), staging banner, and camera access without USB or a local server.
2. Sign in with fictional fixture attendant; look up a card by QR, then printed code. Expected: same customer and immutable pump/product (A02/A03).
3. Take a fresh meter photo, enter amount, save while offline. Expected: Saved on phone, no credit claim (A05).
4. Restart the app offline. Expected: original sale/photo retained in originating account; pending count correct (A08).
5. Reconnect with valid same-account access. Expected: submit, signed photo upload and finalize; only authoritative credited status yields Sale synced (A04).
6. Interrupt the photo upload and retry. Expected: Photo upload failed, local blob retained, same sale identity (A08); successful PUT alone never shows Synced.
7. Lose a submit/finalize response; restart and retry. Expected: reconcile server status first, preserve operation/finalize bodies and exactly one server credit (A04).
8. Exercise an expired permission, throttling and transient server outage. Expected: fresh permission ID only after expiry, Retry-After respected, no data loss (A08).
9. Return price/card/date holds. Expected: zero credit, all holds visible, Awaiting price review for price; photo-complete held sale leaves upload count but remains visible (A14/A23).
10. Sign out with pending sales: use upload-first, then separately leave pending. Expected: upload-first waits for durable outcome; sign-out locks immediately; another account cannot view or upload the queue (A13).
11. At 24-hour expiry, reconnect. Expected: uploads pause and require fresh same-account sign-in; original capture assignment remains (A18).
12. Sign in with gas fixture, capture Cylinder sale and finalize. Expected: cooking gas, kilograms, original rate, server-confirmed credit (A16).
13. Record next sale. Expected: clear customer/value/photo, retain account/pump and Cylinder for gas. No history or corrections added.

For steps 5–7, retain the operation ID and purchase ID (no signed URLs, customer personal data or credentials). With an authorized server-side verification from WO-core-4, check one original purchase, one accepted current revision and one contribution equal to the captured amount before and after repeated retry/reload. Check that photo validation used actual Spaces bytes and that the final private object is immutable. A green receipt alone is insufficient evidence of exactly-once credit. Use only fictional fixtures; failure injection requiring staging data/config changes needs Earl’s separate go. Client fake scenarios below cover interruption cases until the real-endpoint harness can exercise them safely.

## USB fallback (local debugging only)

If staging is unavailable, run the local app and fixture services, then `adb reverse tcp:3000 tcp:3000` and `adb reverse tcp:9000 tcp:9000`; open `http://localhost:3000/attendant/sign-in`. Local storage permissions must point at the phone-reachable localhost port 9000. Repeat the applicable steps and label results **local fallback**. MinIO or fake-backed passes do not satisfy the staging HTTPS/real Spaces M1 exit.

## Phone acceptance record

- Staging URL: pending Earl’s deployed URL
- Deployed commit / WO-core-4 endpoint version: pending
- Android model / Android version / Chrome version: pending
- Date and tester: pending
- Steps 1–13, expected vs actual, operation/purchase IDs: pending
- Server exactly-once and private validated evidence verification: pending
- Earl’s acceptance / failures: pending

Record actual phone/browser, commit, outcomes and any failures here before acceptance. Real endpoint/phone acceptance is pending; automated results are recorded below.

## Automated preparation and execution

Test-engineer exercised the production browser client using the contract-shaped HTTP fake in local Linux Chromium. Initial full run: **64 passed, 4 failed, 4 existing staging-only skips**. The four failures were two fixture assumptions repeated at both viewport projects: upload-first already signs out after completion, and navigation can retain an active request lease. Corrected deterministic delayed-PUT tests passed **8/8 (55.9s)**, with no failures or new skips. The EM independently ran the complete suite on the integrated application and test code: **68 passed, 0 failed, 4 existing staging-only skips**. No new test was skipped. EM-reported gates: 107 unit tests passed and time suites passed 3/3 under UTC and 3/3 under America/New_York.

Design capture: seven initial passes and one fixture navigation race; corrected pending captures passed **2/2 (19.4s)**. All five boards have independently inspected screenshots at 390 px and 360 px. See [upload-sync-fidelity.md](upload-sync-fidelity.md) for differences and the existing WHR-45 formatting follow-up.

The macOS browser sandbox launch limitation was resolved using a local Docker Chromium runner and an isolated fixture Postgres database. These are contract-fake client checks, not real storage/credit or Android smoke acceptance. Earl’s phone smoke remains pending.

EM gates: typecheck, lint, unit tests, production build and timezone tests passed. The browser gate ran with two workers inside the local Linux runner, using the same source with separate Linux dependencies/build output and an isolated fictional fixture database. No cloud operation occurred.

Permanent-error regression: after photo_invalid, leave and reopen the receipt. Needs attention and manager help remain, the original/photo/finalize request remain intact, and manual/foreground retries issue no new write. An authoritative terminal result may resolve the state. This is covered by sync.test.ts and the browser rejected-photo scenario.

Final-head browser note: full runs had 66 passes, two timing-sensitive failures and four existing staging-only skips. Both last-failed cases passed unchanged on the first targeted rerun attempt. WHR-60 tracks synchronizing the partial-upload and expired-PUT fixtures before full navigation; no tests were disabled. GitHub CI must be green before the staging merge.
