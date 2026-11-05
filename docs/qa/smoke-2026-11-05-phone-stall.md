# WO-app-3b phone smoke

Part of WHR-65. Status: baseline investigation; no READY claim.

Use the existing staging app and fictional fixtures only. Baseline deployment: `1a6316c18db51afa3584c0d959935ceae00edadf`, verified through `/api/health` on 5 November 2026. Do not reseed, alter account permissions or change the phone clock on staging. Never export credentials, cookies, signed URLs, photos or customer details in traces.

## Timing protocol

Before changing application code, measure the deployed app with browser performance marks for Save sale click, receipt displayed, Record next sale click, form ready, access-check display start/end and online/offline pill transition. Record navigation timing and sanitized session-request durations separately. Record device/browser, deployed commit, service-worker control, network profile and whether uploads were pending. Keep durations and route categories only.

Repeat the same measurements after deployment. For controlled automation, use 3G (400 ms latency, 400 kbit/s down and up) and offline, with a previously installed shell and valid original sign-in window. Separately delay navigation and session responses to distinguish browser navigation, revalidation and upload work. Use condition-based assertions, no sleeps or runner retries. A synthetic delay must be labelled fault injection, not a naturally observed staging latency.

## Earl's rerun

1. **A02/A03, phone-test step 8:** sign in online with a fictional attendant. Resolve its fixture card, enter `20000`, then leave the amount field. Expect `20,000.00`, unchanged amount and derived quantity. Refocus/edit and repeat with `20000.01`; quantity mode remains unchanged.
2. **A03/A04/A05, step 9:** take a fresh fictional meter photo and tap Save sale. Expect a receipt within 2 seconds on 3G and a durable saved sale/photo. Pending receipt says “Reference after upload”; it does not claim loyalty credit.
3. **A04/A16:** after the server confirms sync, expect its assigned sale code on the receipt. Gas keeps Cylinder and kilograms. The displayed code must match the server result, not the operation UUID.
4. **A04/A05/A02, step 9:** tap Record next sale. Expect an empty form within 2 seconds, retaining the same attendant/pump and the previous durable sale.
5. **A02/A05, step 16:** with the shell installed and a valid sign-in window, turn airplane mode on. Expect Offline within about 2 seconds. Save another fictional sale and record the next: each transition stays within 2 seconds. Close/reopen while offline; pending sales remain available only to their originating attendant.
6. **A08, step 22:** reconnect, observe uploads and open the receipt. Expect the server-assigned reference in the upload row once assigned, and correct pending/held/synced wording independently of connectivity. No duplicate sale or credit on retry.
7. **A18 / controlled automated fixture:** at exactly 24 hours, capture and upload lock and pending records remain. Reconnect/reopen and delayed successful revalidation never renew or unlock the window. A fresh online sign-in is required.
8. **Controlled automated fixture:** a confirmed revocation, sign-out, account change or invalid capture context locks access promptly even if an older request later succeeds. Another account never sees the queue. Do not disable staging accounts for this test.

## Results

Baseline timings, root cause, navigation fallback deadline, after timings and automated test names will be recorded when measured. Physical Samsung acceptance remains Earl's rerun after READY.
