# Draft smoke runbook: WO-app-3

Draft for the future implementation work order, not a claim that the app exists or passes. WO-app-0 is documentation only. Run after its implementation and required automated gates pass.

## Phone setup

Use a disposable local database and fictional fixtures only. Do not use live customer data. The implementation work order must supply fixture setup and failure-injection commands before executing this draft; none are invented here. Record device, Android/Chrome versions, build SHA and date with the results. Never clear browser storage while unsynced sales remain.

Connect an Android phone by USB, enable USB debugging and authorize this computer. On the computer run `adb devices`, then `adb reverse tcp:3000 tcp:3000` and `adb reverse tcp:9000 tcp:9000`. MinIO presigned upload URLs must use `http://localhost:9000` so the phone reaches the local object store through USB; the implementation must document this local configuration. Start the app from its worktree with `pnpm dev`. On phone Chrome open `http://localhost:3000/attendant/sign-in`. Loopback is needed for camera access; allow the in-app camera when prompted. Keep USB connected. To simulate offline over USB, block requests using Chrome remote debugging; airplane mode alone does not cut the adb tunnel. Restore requests for reconnect steps. If the future service worker is disabled in development, use the implementation's documented production-like local build instead; mark offline steps BLOCKED until provided.

Check 390px reference appearance and 360px minimum, keyboard reachability, TalkBack labels, 48px phone controls (44px floor), visible focus, wrapped names and a legible ₦ glyph. Compare against local PNGs under `product-docs/04 UI Design/Hi-Fi/Attendant/`; board IDs below name the expected reference. A gallery-only preview never proves authentication, persistence or credit.

## Scope and prerequisites

WO-app-2 verifies capture through Saved on phone, restart, account isolation and expiry. This runbook verifies server confirmation, transport failures and credit, then repeats the complete M1 exit on the phone. Supply disposable local fixture setup, a photo-failure/lost-response injector, server acceptance/credit inspection, and local MinIO configuration before execution. Mark missing controls BLOCKED; do not guess commands or inspect credentials/signed URL query strings.

## Steps and expected results

1. **A05-SaleSavedOnPhone / A08-PendingUploads** — Begin with app-2’s durable pending queue under the original account; restore requests inside valid access. Expected: Original IDs, pump/rate/evidence remain intact; uploads/retry visible. Connectivity alone never shows Synced.
2. **A08-PendingUploads** — Inject photo-upload failure after details arrive. Expected: Photo upload failed; details received, photo retained on phone, visible failure/retry, no credit. View details retains original context.
3. **A08-PendingUploads / A04-SaleSynced / A23-PendingUploadsEmpty** — Restore photo delivery and retry, including repeated tap. Expected: Same operation IDs, server validates evidence, one accepted sale and **one credit only**. Show A04 only after acceptance; zero waiting/A23 only after all local delivery completes. Empty queue does not imply held sales were credited.
4. **A08-PendingUploads / A04-SaleSynced** — Let server accept a sale, suppress its response using the controlled injector, then retry/reopen and retry again. Expected: Existing result returned for same operation, no second sale or second credit; first receipt and accepted evidence remain unchanged. Confirm with supplied server inspection, not only the UI.
5. **A14-PriceReview / A23-PendingUploadsEmpty** — Upload unresolved capture-time price-mismatch fixture and retry it. Expected: Details/photo received, Awaiting price review, zero credit, original captured values retained; retry never clears hold. A proven earlier-rate capture remains valid despite a different current price. Fully delivered held record may leave queue empty without credit.
6. **A27-SaleOffline / A08-PendingUploads** — Deliver pending-lookup records from app-2: resolved existing card, timeout, definitive no-match. Expected: Resolution permits normal validation; timeout stays pending; definitive no-match cancels with reason, no credit, no customer registration or reassignment.
7. **A15-GasSale / A16-GasSynced** — Deliver a valid gas capture. Expected: Server-confirmed gas receipt with Cooking gas/Cylinder/kg, captured rate, basis and exact total; customer category unchanged; one credit only. Next sale keeps Cylinder.
8. **A13-Handover / A08-PendingUploads / A01-SignIn** — Exercise Upload, then sign out online with pending fixtures. Expected: Sign-out follows confirmed delivery, not connection alone; failed delivery preserves records and explicit pending choice. Logout pauses originating-account uploads; other account cannot submit them.

## M1 exit: end to end on the real phone

1. **A01-SignIn / A02-Sale / A03-SaleFilled** — Confirm both `adb reverse tcp:3000 tcp:3000` and `adb reverse tcp:9000 tcp:9000`; open phone localhost app, sign in online, resolve a customer by QR and then by typed code, enter valid values and take a fresh live photo. Expected: Both lookups identify the same card/customer; correct assignment and captured price; readable evidence.
2. **A27-SaleOffline / A05-SaleSavedOnPhone** — Block requests via remote debugging, capture/save offline within 24 hours, then close/reopen the supported app/browser. Expected: Durable record, operation ID and photo survive restart; no credit; offline shell/fonts work. Never clear storage.
3. **A08-PendingUploads / A04-SaleSynced / A23-PendingUploadsEmpty** — Restore requests and complete the signed upload through phone localhost:9000. Expected: Actual photo bytes reach validation and accepted evidence, original operation is accepted exactly once, synced receipt appears and pending count clears. Retry once after confirmation: **one credit only**, verified with supplied server inspection. Repeat for gas and compare **A16-GasSynced**. Record phone/build/result evidence; a desktop simulation cannot pass this exit.

## Result record

For each step record PASS / FAIL / BLOCKED, actual result and screenshot reference. Record unresolved fixture/service-worker setup as BLOCKED, never PASS. At WO-app-0 review Earl reads this draft; implementation execution happens in the named future work order.
