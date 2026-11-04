# Draft smoke runbook: WO-app-2

Draft for the future implementation work order, not a claim that the app exists or passes. WO-app-0 is documentation only. Run after its implementation and required automated gates pass.

## Phone setup

Use a disposable local database and fictional fixtures only. Do not use live customer data. The implementation work order must supply fixture setup and failure-injection commands before executing this draft; none are invented here. Record device, Android/Chrome versions, build SHA and date with the results. Never clear browser storage while unsynced sales remain.

Connect an Android phone by USB, enable USB debugging and authorize this computer. On the computer run `adb devices`, then `adb reverse tcp:3000 tcp:3000`. Start the app from its worktree with `pnpm dev`. On phone Chrome open `http://localhost:3000/attendant/sign-in`. Loopback is needed for camera access; allow the in-app camera when prompted. Keep USB connected. To simulate offline over USB, block requests using Chrome remote debugging; airplane mode alone does not cut the adb tunnel. Restore requests for reconnect steps. If the future service worker is disabled in development, use the implementation's documented production-like local build instead; mark offline steps BLOCKED until provided.

Check 390px reference appearance and 360px minimum, keyboard reachability, TalkBack labels, 48px phone controls (44px floor), visible focus, wrapped names and a legible ₦ glyph. Compare against local PNGs under `product-docs/04 UI Design/Hi-Fi/Attendant/`; board IDs below name the expected reference. A gallery-only preview never proves authentication, persistence or credit.

## Steps and expected results

1. **A01-SignIn** — Sign in online with the supplied fictional Pump 02 attendant. Expected: No pump/product picker; successful session enters /attendant/sale with current station, pump, product and personal identity.
2. **A26-SignInError** — Sign out; try incorrect credentials online, then block requests and attempt sign-in. Expected: Wrong-details error differs from no-connection notice; no session is created; sign-in unavailable offline. Restore requests.
3. **A12-Account** — Sign in again and open Account. Expected: Name, username, permanent ID, station, assigned pump and own pending count appear; offline window copy is present.
4. **A13-Handover** — With the supplied two-record local queue, open Hand over device; choose Stay signed in. Expected: Pending loyalty consequence is clear and no logout occurs. Upload-first failure preserves queue and offers an explicit choice; zero pending uses ordinary Sign out.
5. **A02-Sale / A24-SaleCustomerNotFound** — Enter an unmatched code and Find; then try a simulated network failure. Expected: Definitive no-match shows the card error and registration escape; a timeout stays retryable and does not claim no customer.
6. **A03-SaleFilled** — Resolve A7K3M9Q, choose Vehicle and Amount; enter 20000.00 at fixture rate 1000.00/litre. Take and retake a fresh photo. Expected: About 20.000 litres; one value editable, photo legible, no gallery picker; Save sale enabled only with complete valid input.
7. **A02-Sale / A03-SaleFilled** — Switch to Litres and enter 5.25; try invalid decimals and missing evidence. Expected: Switch clears the old number; quantity mode derives exact amount; invalid input disables save with an actionable error; no floating point spend.
8. **A04-SaleSynced** — Save while connected, including a second tap during save. Expected: Saving blocks repeat submission; Sale synced only after server validation of details and photo; one record and one credit. Receipt preserves attribution, basis, rate, quantity and total.
9. **A04-SaleSynced / A02-Sale** — Tap Record next sale. Expected: Customer, liquid medium, entry and photo clear; Amount default returns; account/pump persist; prior record remains separately saved.
10. **A15-GasSale / A16-GasSynced** — Use the fictional Pump 05 gas account; resolve the same customer, enter 15000.00 at fixture 1500.00/kg, capture photo and save. Expected: Read-only Cylinder; Amount/Kilograms; About 10.00 kg; same Car owner category; server-confirmed receipt totals ₦15,000.00. Next sale retains Cylinder.

## Result record

For each step record PASS / FAIL / BLOCKED, actual result and screenshot reference. Record unresolved fixture/service-worker setup as BLOCKED, never PASS. At WO-app-0 review Earl reads this draft; implementation execution happens in the named future work order.
