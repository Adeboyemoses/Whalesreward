# WO-app-3 upload and receipt smoke

Status: BUILD. Earl approved WHR-7 on 5 November 2026. WHR-5 remains READY pending its phone smoke.

Automated verification uses the contract-shaped fake through the typed adapter. It does not prove real server credit or physical Android operation. Full M1 phone exit requires WO-core-3/4 endpoints and local fixture services.

1. Start the local fixture services and app using the repository runbook. For Android USB use `adb reverse tcp:3000 tcp:3000` and `adb reverse tcp:9000 tcp:9000`, then open `http://localhost:3000/attendant/sign-in`. Expected: online sign-in (A01).
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

Record actual phone/browser, commit, outcomes and any failures here before acceptance. Real endpoint/phone acceptance is pending; automated results will be added before READY.

## Automated preparation and execution

Test-engineer prepared `tests/e2e/upload-sync.spec.ts` and `tests/design-parity/uploads/capture.spec.ts` with a contract-shaped HTTP fake. Typecheck and lint passed. The first Playwright attempt built the production app successfully but failed before executing the scenario: Chromium macOS process registration was denied by the sandbox (`Permission denied (1100)`, SIGTRAP). Result: 1 launch failure, 0 browser scenarios executed. Browser and fidelity verification remain pending; this is not a smoke pass.
