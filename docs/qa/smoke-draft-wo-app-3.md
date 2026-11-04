# Draft smoke runbook: WO-app-3

Draft for the future implementation work order, not a claim that the app exists or passes. WO-app-0 is documentation only. Run after its implementation and required automated gates pass.

## Phone setup

Use a disposable local database and fictional fixtures only. Do not use live customer data. The implementation work order must supply fixture setup and failure-injection commands before executing this draft; none are invented here. Record device, Android/Chrome versions, build SHA and date with the results. Never clear browser storage while unsynced sales remain.

Connect an Android phone by USB, enable USB debugging and authorize this computer. On the computer run `adb devices`, then `adb reverse tcp:3000 tcp:3000`. Start the app from its worktree with `pnpm dev`. On phone Chrome open `http://localhost:3000/attendant/sign-in`. Loopback is needed for camera access; allow the in-app camera when prompted. Keep USB connected. To simulate offline over USB, block requests using Chrome remote debugging; airplane mode alone does not cut the adb tunnel. Restore requests for reconnect steps. If the future service worker is disabled in development, use the implementation's documented production-like local build instead; mark offline steps BLOCKED until provided.

Check 390px reference appearance and 360px minimum, keyboard reachability, TalkBack labels, 48px phone controls (44px floor), visible focus, wrapped names and a legible ₦ glyph. Compare against local PNGs under `product-docs/04 UI Design/Hi-Fi/Attendant/`; board IDs below name the expected reference. A gallery-only preview never proves authentication, persistence or credit.

## Steps and expected results

1. **A27-SaleOffline** — Sign in online and load the shell/customer fixture, then block requests and reopen within 24 hours. Expected: Shell/fonts load; deadline anchored to last successful sign-in; saved assignment and price remain; no new login is possible.
2. **A27-SaleOffline / A05-SaleSavedOnPhone** — Record a complete sale and photo offline, then reopen. Expected: Saved on phone appears only after atomic durable storage; record/photo/count survive supported restart; no credit claimed. Failed local save retains form and never shows saved.
3. **A27-SaleOffline** — Capture with an unknown local card code. Expected: Save pending for deferred lookup per F05; no offline registration or claimed customer resolution. A later timeout leaves pending; definitive no-match cancels with reason.
4. **A08-PendingUploads** — Restore requests and inject a photo-upload failure after details arrive. Expected: Photo upload failed; photo remains on phone; no loyalty credit. View details preserves original pump, rate, card and evidence state.
5. **A08-PendingUploads / A23-PendingUploadsEmpty** — Retry, including a lost response/retry and second tap. Expected: Same operation IDs; one credit only after all checks; count reaches zero after server receipt. All uploads complete does not imply every record is credited.
6. **A14-PriceReview** — Submit fixture with unresolved capture-time price mismatch; retry it. Expected: Details/photo received, Awaiting price review, zero credit; original values retained and retry never clears hold. Proven earlier-rate sale is not held merely because current price differs.
7. **A13-Handover / A12-Account** — Leave pending records, sign out with pending, sign in online as another ordinary fixture account. Expected: Other account sees none of original queue and cannot upload/edit it. Same original account online sign-in resumes without changing IDs or attribution.
8. **A18-OfflineExpired** — Use the implementation-provided controlled sign-in age fixture at exactly 24 hours; reopen and reconnect. Expected: Capture and uploads paused; records/photos retained; reconnect/reopen does not renew. Do not change staging data or the phone clock to create this case.
9. **A18-OfflineExpired / A01-SignIn / A08-PendingUploads** — Restore connectivity, continue to sign-in and authenticate as original account. Expected: Fresh same-account online sign-in renews window and resumes normal validation; different account cannot access queue; count/identity unchanged.

## Result record

For each step record PASS / FAIL / BLOCKED, actual result and screenshot reference. Record unresolved fixture/service-worker setup as BLOCKED, never PASS. At WO-app-0 review Earl reads this draft; implementation execution happens in the named future work order.
