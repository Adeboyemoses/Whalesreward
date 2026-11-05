# WO-app-3b phone smoke

Part of WHR-65. Status: READY; feature deployed at `d3481fc6e39dabe8ab5e087ee581b91d891f56ed`.

Use the existing staging app and fictional fixtures only. Baseline deployment: `1a6316c18db51afa3584c0d959935ceae00edadf`, verified through `/api/health` on 5 November 2026. Do not reseed, alter account permissions or change the phone clock on staging. Never export credentials, cookies, signed URLs, photos or customer details in traces.

## Timing protocol

Before changing application code, measure the deployed app with browser performance marks for Save sale click, receipt displayed, Record next sale click, form ready, access-check display start/end and online/offline pill transition. Record navigation timing and sanitized session-request durations separately. Record device/browser, deployed commit, service-worker control, network profile and whether uploads were pending. Keep durations and route categories only.

The original plan called for repeated desktop measurements after deployment. Earl and Rook superseded that step: do not use Computer Use for timings; see the READY scope below. For controlled automation, use 3G (400 ms latency, 400 kbit/s down and up) and offline, with a previously installed shell and valid original sign-in window. Separately delay navigation and session responses to distinguish browser navigation, revalidation and upload work. Use condition-based assertions, no sleeps or runner retries. A synthetic delay must be labelled fault injection, not a naturally observed staging latency.

## Earl's rerun

1. **A02/A03, phone-test step 8:** sign in online with a fictional attendant. Resolve its fixture card, enter `20000`, then leave the amount field. Expect `20,000.00`, unchanged amount and derived quantity. Refocus/edit and repeat with `20000.01`; quantity mode remains unchanged.
2. **A03/A04/A05, step 9:** take a fresh fictional meter photo and tap Save sale. Expect a receipt within 2 seconds on 3G and a durable saved sale/photo. Before a server reference exists, the receipt says “Reference after upload”; it does not claim loyalty credit.
3. **A04/A16:** after the server confirms sync, expect its assigned sale code on the receipt. Gas keeps Cylinder and kilograms. The displayed code must match the server result, not the operation UUID.
4. **A04/A05/A02, step 9:** tap Record next sale. Expect an empty form within 2 seconds, retaining the same attendant/pump and the previous durable sale.
5. **A02/A05, step 16:** with the shell installed and a valid sign-in window, turn airplane mode on. Expect Offline within about 2 seconds. Save another fictional sale and record the next: each transition stays within 2 seconds. Close/reopen while offline; pending sales remain available only to their originating attendant.
6. **A08, step 22:** reconnect, observe uploads and open the receipt. Expect the server-assigned reference in the upload row once assigned, and correct pending/held/synced wording independently of connectivity. No duplicate sale or credit on retry.
7. **A18 / controlled automated fixture:** at exactly 24 hours, capture and upload lock and pending records remain. Reconnect/reopen and delayed successful revalidation never renew or unlock the window. A fresh online sign-in is required.
8. **Controlled automated fixture:** a confirmed revocation, sign-out, account change or invalid capture context locks access promptly even if an older request later succeeds. Another account never sees the queue. Do not disable staging accounts for this test.

## Results

[Baseline and cause](phone-stall-baseline.md): measured before edits, Save 4145.2 ms and next sale 2021.9 ms under desktop 3G emulation; the reported 1–3 minute wait was not reproduced. Navigation fallback is 1200 ms. [Regression evidence](phone-smoke-regressions.md): final EM unit164, browser94 passed/4 existing skips/zero retries, typecheck/lint/build PASS; final CI integration129 and all required checks green. [PR #49](https://github.com/Adeboyemoses/Whalesreward/pull/49) is deployed; health returned the exact commit above and `db: ok`. The 24-hour and revocation checks remain equally strict.

The steps above retain the implementation's two-second automated target. Rook's separate phone-test acceptance rubric is three seconds, as recorded below.

## READY handoff scope, 5 November 2026

Earl instructed this session to post READY with deployed commit `d3481fc6e39dabe8ab5e087ee581b91d891f56ed` and the handoff caveat **“physical Samsung acceptance pending Earl's rerun”**, then stop. Rook's 20:21 UTC comment on [WHR-65](https://linear.app/phaneum/issue/WHR-65) supersedes the desktop after-timing requirement: do not use Computer Use for timings. No deployed after-performance marks or numeric Samsung timings are claimed. Automated Save/next assertions remain two seconds; Rook's M1 Phone Test page uses a separate three-second physical acceptance threshold for steps 8, 9, 10, 16 and 22.

A subsequent 20:36 UTC comment on WHR-65 reports Earl's Samsung S25 acceptance: lag gone, faster capture, quick offline response and visible sale reference. It explicitly says results were not stored on the M1 Phone Test page; the in-session acceptance is the record. This is reported human acceptance, not an instrumented timing result. This session preserves the requested READY handoff and stops; it does not close WHR-65, WHR-5 or WHR-7 or declare M1 closed.
