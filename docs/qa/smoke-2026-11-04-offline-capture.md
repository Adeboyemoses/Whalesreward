# Phone smoke runbook: WO-app-2 — 4 November 2026

Accepted by Earl on 5 November 2026 as part of the M1 phone exit. Earl explicitly authorized closing WHR-5, WHR-7 and WHR-65 after his Samsung rerun; [closeout PR #52](https://github.com/Adeboyemoses/Whalesreward/pull/52). This supersedes earlier pending-acceptance notes below. The phone rerun record and limits are in [the phone-stall runbook](smoke-2026-11-05-phone-stall.md#accepted-phone-rerun-and-closeout-5-november-2026); no numeric after-timing results are claimed.

Written before implementation for WHR-5. Execute only after WO-core-3 merges and the real session/sign-in endpoints are available. Earl requested READY with automated Playwright evidence first; phone acceptance remains pending. Test-only contract fakes do not establish real authentication or device acceptance.

## Phone setup

Use a disposable local database and fictional fixtures only. Do not use live customer data. The implementation work order must supply fixture setup and failure-injection commands before executing this draft; none are invented here. Record device, Android/Chrome versions, build SHA and date with the results. Never clear browser storage while unsynced sales remain.

Connect an Android phone by USB, enable USB debugging and authorize this computer. On the computer run `adb devices`, then `adb reverse tcp:3000 tcp:3000`. Start a production build from its worktree with `pnpm build` then `pnpm start`. On phone Chrome open `http://localhost:3000/attendant/sign-in`. Loopback is needed for camera access; allow the in-app camera when prompted. Keep USB connected. To simulate offline over USB, block requests using Chrome remote debugging; airplane mode alone does not cut the adb tunnel. Restore requests for reconnect steps. If the future service worker is disabled in development, use the implementation's documented production-like local build instead; mark offline steps BLOCKED until provided.

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

For each step record PASS / FAIL / BLOCKED, actual result and screenshot reference. Record unresolved fixture/service-worker setup as BLOCKED, never PASS. Phone execution waits for WO-core-3. Automated coverage and exact fixture commands will be recorded below after implementation; never mark unexecuted phone steps PASS.

## Automated reproduction and fixture boundary

Run these from the WO-app-2 worktree with Node/pnpm versions pinned by the repository. Keep port 3000 free. `pnpm test:e2e` builds production and starts a local server itself; use the standalone command rather than chaining it with shell edits.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm test:e2e
```

To run only the capture suite on the phone-sized Chromium project:

```sh
pnpm test:e2e --project=attendant --workers=1 tests/e2e/offline-capture.spec.ts
```

The test transport is `tests/fixtures/attendant-http-fake.ts`. It returns the exact M1 envelope and Session/Lookup fields for fictional Grace Okon (Pump 02, PMS, ₦1,000.00/litre, precision 3) and Favour James (Pump 05, cooking gas, ₦1,500.00/kg, precision 2). Card A7K3M9Q resolves to fictional Amina Bello, Car owner. It intercepts local browser requests only; the production client has no fake account or testing switch. These credentials are not real-server login instructions. Any call to an upload endpoint fails the capture test.

`offline-capture.spec.ts` exercises real IndexedDB, the built Workbox worker, a live browser media stream supplied by Chromium's fake-camera flag, and `context.setOffline(true)`. It includes direct offline receipt navigation, closing and reopening a persistent browser profile, same/different-account handover, cross-tab isolation, exact 24-hour and rollback locks, online session revalidation, exact gas arithmetic, and cache inspection. Native QR decoding is replaced by a test decoder returning the printed code; actual QR readability and meter-photo readability remain phone checks.

The quota and controlled-time steps above have automated fault injection in disposable browser contexts. No manual production injector is supplied. Until WO-core-3 provides real fixture accounts and the session endpoint, phone steps remain deferred; after that merge use its documented account setup. Record unavailable phone fault injection as BLOCKED and link the corresponding automated test, never manufacture a phone PASS.

For independent design capture, after `pnpm build`, keep port 3102 free and run:

```sh
pnpm test:e2e --config tests/design-parity/offline/playwright.config.ts
```

Screenshots and the comparison report are under `tests/design-parity/offline/screenshots/` and `docs/qa/offline-capture-fidelity.md`. Browser checks do not establish daylight readability, camera focus, real endpoint authentication, TalkBack behavior or phone storage durability.

The root layout emits a generic runtime staging banner. Workbox discovers versioned attendant assets from build manifests and caches fixed generic route URLs at installation; it does not require build-time HTML. This preserves the banner without server-rendered account data.
