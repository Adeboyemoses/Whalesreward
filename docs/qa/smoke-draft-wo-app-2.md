# Draft smoke runbook: WO-app-2

Draft for the future implementation work order, not a claim that the app exists or passes. WO-app-0 is documentation only. Run after its implementation and required automated gates pass.

## Phone setup

Use a disposable local database and fictional fixtures only. Do not use live customer data. The implementation work order must supply fixture setup and failure-injection commands before executing this draft; none are invented here. Record device, Android/Chrome versions, build SHA and date with the results. Never clear browser storage while unsynced sales remain.

Connect an Android phone by USB, enable USB debugging and authorize this computer. On the computer run `adb devices`, then `adb reverse tcp:3000 tcp:3000`. Start the app from its worktree with `pnpm dev`. On phone Chrome open `http://localhost:3000/attendant/sign-in`. Loopback is needed for camera access; allow the in-app camera when prompted. Keep USB connected. To simulate offline over USB, block requests using Chrome remote debugging; airplane mode alone does not cut the adb tunnel. Restore requests for reconnect steps. If the future service worker is disabled in development, use the implementation's documented production-like local build instead; mark offline steps BLOCKED until provided.

Check 390px reference appearance and 360px minimum, keyboard reachability, TalkBack labels, 48px phone controls (44px floor), visible focus, wrapped names and a legible ₦ glyph. Compare against local PNGs under `product-docs/04 UI Design/Hi-Fi/Attendant/`; board IDs below name the expected reference. A gallery-only preview never proves authentication, persistence or credit.

## Scope

WO-app-2 ends at durable Saved on phone. Server confirmation, synced receipts and one-credit verification belong to [WO-app-3](smoke-draft-wo-app-3.md). Use implementation-provided local fixtures/transport controls to keep submissions pending even in the online-capture cases.

## Steps and expected results

1. **A01-SignIn / A26-SignInError** — Sign in online as the fictional Pump 02 attendant; separately try wrong credentials and no connection. Expected: Distinct wrong-details/no-connection states; no offline sign-in; assignment and identity come from successful sign-in, with no pump/product picker.
2. **A12-Account / A13-Handover** — Open Account, then hand-over with a supplied two-record queue; choose Stay signed in. Expected: Personal ID/assignment/own pending count shown; queue and loyalty warning preserved; staying makes no changes. Offline upload-first is disabled; zero pending offers ordinary sign-out. Actual upload-first completion is checked in app-3.
3. **A02-Sale / A24-SaleCustomerNotFound** — Enter a definitively unmatched card, then simulate lookup timeout. Expected: No-match error differs from retryable network failure; invalid online lookup cannot save. Register link check: **N/A for M1** — omit “Register this customer” until WO-app-6 (M2) supplies `/attendant/register`; no link to an unavailable route.
4. **A02-Sale / A03-SaleFilled** — Resolve the fixture via QR and typed code; choose Vehicle and enter 20000.00 at fixture rate 1000.00/litre. Expected: Same customer for both lookups, About 20.000 litres, Amount default, only chosen value editable. Switch to Litres: old entry clears. Invalid decimals/missing evidence visibly prevent save. AppHeader shows Online or Offline and checks access before capture and save.
5. **A03-SaleFilled / A05-SaleSavedOnPhone** — Take/retake a fresh readable photo; save with delivery held by the local fixture, including a second tap. Expected: No gallery option; saving blocks duplicate taps; Saved on phone only after atomic durable details/photo storage; no credit or Synced claim. Record next sale resets customer/liquid medium/entry/photo, keeps assignment and retains prior record separately.
6. **A27-SaleOffline / A05-SaleSavedOnPhone** — Block requests within the valid window and capture another sale with saved customer/rate. Expected: Offline pill and deadline, captured rate/version retained; durable pending result and no credit. Close/reopen the supported app/browser without clearing storage: shell/fonts, queue, IDs and photo survive restart.
7. **A27-SaleOffline / A05-SaleSavedOnPhone** — While offline use a card absent from the local cache. Expected: Card code and sale save as pending lookup; no fabricated customer or offline registration. Server resolution is checked in app-3.
8. **A03-SaleFilled / A27-SaleOffline** — Deny camera permission, then restore it. Expected: Visible actionable denial, retained form, no photo or successful save claimed; in-app camera can be retried.
9. **A03-SaleFilled / A27-SaleOffline** — Inject `QuotaExceededError` during local record/photo transaction using the supplied disposable test fixture. Expected: Storage-full save failure visibly explains the failure, preserves the form, shows no Saved on phone, and adds no partial queue record. Restore storage fixture and retry successfully. Mark BLOCKED if the injector is unavailable; never fill storage containing real pending records.
10. **A15-GasSale / A05-SaleSavedOnPhone** — Sign in as fictional Pump 05 account and capture gas with delivery held. Expected: Cooking gas, read-only Cylinder, Amount/Kilograms, 15000.00 at fixture 1500.00/kg displays About 10.00 kg; customer category stays Car owner; local pending result only. Next sale keeps Cylinder. A16 server-confirmed receipt belongs to app-3.
11. **A13-Handover / A12-Account** — Sign out with pending records; sign in online as another ordinary fixture account. Expected: Other account sees none of the original queue and cannot edit/upload it. Original account’s subsequent online sign-in restores its own queue without changing IDs/attribution.
12. **A18-OfflineExpired / A02-Sale / A01-SignIn** — Use a controlled local sign-in-age fixture: test capture at exactly 24 hours and a form begun before expiry but saved at expiry. Expected: Both blocked, uploads paused, pending sales/photos retained. Reopen/reconnect does not renew; fresh original-account online sign-in does. Do not change phone clock or staging data. Offline sign-in remains unavailable.

## Result record

For each step record PASS / FAIL / BLOCKED, actual result and screenshot reference. Record unresolved fixture/service-worker setup as BLOCKED, never PASS. At WO-app-0 review Earl reads this draft; implementation execution happens in the named future work order.
