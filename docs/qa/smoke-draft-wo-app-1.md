# Draft smoke runbook: WO-app-1

Draft for the future implementation work order, not a claim that the app exists or passes. WO-app-0 is documentation only. Run after its implementation and required automated gates pass.

## Phone setup

Use a disposable local database and fictional fixtures only. Do not use live customer data. The implementation work order must supply fixture setup and failure-injection commands before executing this draft; none are invented here. Record device, Android/Chrome versions, build SHA and date with the results. Never clear browser storage while unsynced sales remain.

Connect an Android phone by USB, enable USB debugging and authorize this computer. On the computer run `adb devices`, then `adb reverse tcp:3000 tcp:3000`. Start the app from its worktree with `pnpm dev`. On phone Chrome open `http://localhost:3000/attendant/sign-in`. Loopback is needed for camera access; allow the in-app camera when prompted. Keep USB connected. To simulate offline over USB, block requests using Chrome remote debugging; airplane mode alone does not cut the adb tunnel. Restore requests for reconnect steps. If the future service worker is disabled in development, use the implementation's documented production-like local build instead; mark offline steps BLOCKED until provided.

Check 390px reference appearance and 360px minimum, keyboard reachability, TalkBack labels, 48px phone controls (44px floor), visible focus, wrapped names and a legible ₦ glyph. Compare against local PNGs under `product-docs/04 UI Design/Hi-Fi/Attendant/`; board IDs below name the expected reference. A gallery-only preview never proves authentication, persistence or credit.

## Steps and expected results

1. **A02-Sale** — Open the future gallery entry supplied by WO-app-1. Expected: Header, fields, segments, photo well and sticky action/nav match the sale board; no business action is represented as live.
2. **A12-Account** — Inspect the gallery header, key-value list and navigation states. Expected: Identity is fictional; Account has aria-current; pending badge has an accessible count.
3. **A03-SaleFilled** — Inspect taken-photo, input, segment and button variants using keyboard and TalkBack. Expected: Real labels and aria-pressed; invalid fields describe errors; disabled actions retain reasons; taken-photo preview is an actual fixture image, not the dark placeholder.
4. **A05-SaleSavedOnPhone / A14-PriceReview / A08-PendingUploads** — Inspect pending, held and failed preview variants. Expected: Words distinguish Saved on phone, Awaiting price review and Photo upload failed; colour alone carries no meaning.
5. **A18-OfflineExpired** — Inspect the unauthenticated shell at 360px and with large text. Expected: No bottom nav; actions stay reachable. Offline behavior itself belongs to WO-app-3, not this gallery check.

## Result record

For each step record PASS / FAIL / BLOCKED, actual result and screenshot reference. Record unresolved fixture/service-worker setup as BLOCKED, never PASS. At WO-app-0 review Earl reads this draft; implementation execution happens in the named future work order.
